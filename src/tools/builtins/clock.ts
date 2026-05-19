import type { ToolDefinition } from "../../types/tool.js";

interface ClockInput {
  timezone?: string;
}

interface ClockOutput {
  iso: string;
  unix: number;
  timezone: string;
}

export const clockTool: ToolDefinition<ClockInput, ClockOutput> = {
  name: "clock.now",
  description: "Returns the current local time or UTC. Optionally accepts an IANA timezone string.",
  inputSchema: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "IANA timezone, e.g. 'Europe/Berlin'" },
    },
    additionalProperties: false,
  },
  async execute(input) {
    const tz = input.timezone ?? "UTC";
    const now = new Date();
    const iso = now.toLocaleString("sv-SE", { timeZone: tz }).replace(" ", "T");
    return { iso, unix: Math.floor(now.getTime() / 1000), timezone: tz };
  },
};
