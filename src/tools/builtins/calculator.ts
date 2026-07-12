import type { ToolDefinition } from "../../types/tool.js";

interface CalcInput {
  expression: string;
}

interface CalcOutput {
  expression: string;
  result: number;
}

/** Evaluates basic arithmetic safely using a recursive descent parser. No eval(). */
function safeEval(expr: string): number {
  const matched = expr.replace(/\s+/g, "").match(/\d+\.?\d*|[+\-*/()]/g);
  if (!matched) throw new Error("Invalid expression");
  // Bind to a non-nullable const so the nested parser closures below see a
  // definitely-present token array (control-flow narrowing does not cross
  // function boundaries).
  const tokens: RegExpMatchArray = matched;

  let pos = 0;

  function parseExpr(): number {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
      const op = tokens[pos++]!;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
      const op = tokens[pos++]!;
      const right = parseFactor();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number {
    if (tokens[pos] === "(") {
      pos++;
      const val = parseExpr();
      if (tokens[pos] !== ")") throw new Error("Missing closing parenthesis");
      pos++;
      return val;
    }
    const num = parseFloat(tokens[pos++]!);
    if (isNaN(num)) throw new Error(`Unexpected token: ${tokens[pos - 1]}`);
    return num;
  }

  return parseExpr();
}

export const calculatorTool: ToolDefinition<CalcInput, CalcOutput> = {
  name: "calculator.evaluate",
  description: "Evaluates a simple arithmetic expression (+, -, *, /, parentheses). No eval().",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Arithmetic expression, e.g. '12 * (3 + 4)'" },
    },
    required: ["expression"],
    additionalProperties: false,
  },
  // GDPR Art. 30 metadata (surfaced by GET /v1/compliance/vvt). Pure arithmetic
  // on the request payload — no personal data, no external recipients.
  manifest: {
    purpose: "Arithmetische Auswertung eines vom Nutzer übergebenen Ausdrucks",
    dataCategories: [],
    recipients: [],
  },
  async execute(input) {
    const result = safeEval(input.expression);
    return { expression: input.expression, result };
  },
};
