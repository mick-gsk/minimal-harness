#!/usr/bin/env python3
"""smolagents ToolCallingAgent sidecar for the minimal-harness bench matrix.

Reads ONE job as JSON on stdin, runs a ToolCallingAgent whose tools are thin
HTTP wrappers over the Node-side WorldState bridge (single source of truth stays
in Node), and writes ONE result line `SMOLARESULT:{...}` on stdout.

All library / rich / log output is redirected to stderr (fd-level) so stdout
carries only the result line — robust against smolagents' console output.

Job schema (from bench/harnesses/smolagents.ts):
  { prompt, maxSteps, bridgeUrl, agentType: "tool" | "code",
    model: { id, apiBase, apiKey, temperature, seed },
    tools: [ { name, description, inputSchema } ] }

agentType "tool" (default) runs ToolCallingAgent (JSON tool calls);
"code" runs CodeAgent — HF's recommended default (actions as Python code).
Result schema:
  { finalAnswer, terminatedReason, toolCalls, tokens, steps, agentMs, error }
"""
import sys
import os
import json
import time
import urllib.request


def post_tool(bridge_url: str, real_name: str, kwargs: dict) -> dict:
    """Invoke a JS world-tool through the Node HTTP bridge."""
    body = json.dumps({"args": kwargs}).encode("utf-8")
    req = urllib.request.Request(
        f"{bridge_url}/tool/{real_name}",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_tools(specs: list, bridge_url: str, counter: dict) -> list:
    """Turn Node tool-specs into smolagents Tool instances backed by the bridge.

    smolagents requires tool names to be valid Python identifiers, so dotted
    names (kv.set) are sanitized (kv_set) for the agent while the bridge is still
    called with the real name. Semantically identical; noted as a fairness caveat.
    """
    from smolagents import Tool

    tools = []
    for spec in specs:
        real_name = spec["name"]
        safe_name = real_name.replace(".", "_").replace("-", "_")
        props = (spec.get("inputSchema") or {}).get("properties", {}) or {}
        inputs = {}
        for key, val in props.items():
            val = val or {}
            inputs[key] = {
                "type": val.get("type", "string"),
                "description": val.get("description") or f"{key} argument",
            }

        param_names = list(inputs.keys())

        def make_forward(rn: str, params: list):
            def _invoke(payload: dict):
                counter["n"] += 1
                data = post_tool(bridge_url, rn, payload)
                if data.get("ok"):
                    return json.dumps(data.get("result"))
                # Tool error → raise so smolagents surfaces it to the model as an
                # observation (error-recovery tasks depend on the model seeing it).
                raise RuntimeError(data.get("error", "tool error"))

            # smolagents inspects forward's signature and requires named params
            # matching `inputs` (not **kwargs), so synthesize an exact signature.
            sig = ", ".join(params)
            mapping = ", ".join(f"{p!r}: {p}" for p in params)
            src = f"def forward(self{', ' if sig else ''}{sig}):\n    return _invoke({{{mapping}}})\n"
            ns: dict = {}
            exec(src, {"_invoke": _invoke}, ns)  # controlled codegen for tool signature
            return ns["forward"]

        tool_cls = type(
            f"Tool_{safe_name}",
            (Tool,),
            {
                "name": safe_name,
                "description": spec["description"],
                "inputs": inputs,
                "output_type": "string",
                "forward": make_forward(real_name, param_names),
            },
        )
        tools.append(tool_cls())
    return tools


def main() -> None:
    job = json.load(sys.stdin)

    # fd-level redirect: any library stdout goes to stderr; keep the real stdout
    # (fd 1) aside for the single result line.
    real_stdout = os.fdopen(os.dup(1), "w")
    os.dup2(2, 1)

    max_steps = int(job.get("maxSteps", 6))
    result = {
        "finalAnswer": None,
        "terminatedReason": "error",
        "toolCalls": 0,
        "tokens": 0,
        "steps": 0,
        "agentMs": 0.0,
        "error": None,
    }
    counter = {"n": 0}
    try:
        from smolagents import CodeAgent, ToolCallingAgent, OpenAIServerModel

        m = job["model"]
        model_kwargs = {"temperature": m.get("temperature", 0.7)}
        if m.get("seed") is not None:
            model_kwargs["seed"] = m["seed"]
        model = OpenAIServerModel(
            model_id=m["id"],
            api_base=m["apiBase"],
            api_key=m.get("apiKey", "ollama"),
            **model_kwargs,
        )
        tools = build_tools(job["tools"], job["bridgeUrl"], counter)
        agent_cls = CodeAgent if job.get("agentType") == "code" else ToolCallingAgent
        agent = agent_cls(tools=tools, model=model, verbosity_level=0)

        t0 = time.time()
        answer = agent.run(job["prompt"], max_steps=max_steps)
        result["agentMs"] = (time.time() - t0) * 1000.0

        steps = int(getattr(agent, "step_number", 0) or 0)
        result["finalAnswer"] = None if answer is None else str(answer)
        result["steps"] = steps
        result["terminatedReason"] = "max_steps" if steps >= max_steps else "final_answer"
        mon = getattr(agent, "monitor", None)
        if mon is not None:
            result["tokens"] = int(getattr(mon, "total_input_token_count", 0) or 0) + int(
                getattr(mon, "total_output_token_count", 0) or 0
            )
        result["toolCalls"] = counter["n"]
        result["error"] = None
    except Exception as exc:  # noqa: BLE001 — sidecar must always report, never crash silently
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["toolCalls"] = counter["n"]

    real_stdout.write("SMOLARESULT:" + json.dumps(result) + "\n")
    real_stdout.flush()


if __name__ == "__main__":
    main()
