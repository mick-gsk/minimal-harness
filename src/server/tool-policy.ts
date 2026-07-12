/**
 * Tool-level RBAC (NIS2 (7), DSGVO Art. 32, AI Act Art. 26): a role→tool
 * permission matrix. Roles list the tool-name patterns they may use; users are
 * assigned to a role. Enforced as a *filter before the loop* — a user's
 * ToolBridge only ever contains the tools their role allows, so the model never
 * sees a forbidden tool (no prompt noise, nothing to jailbreak around). A tool
 * name the model hallucinates anyway falls through to the existing
 * unknown-tool path in the ToolBridge.
 */

export interface ToolPolicy {
  /** roleName -> allowed tool-name patterns (exact, prefix "fs.*", or "*"). */
  roles: Record<string, string[]>;
  /** userId -> roleName. */
  userRoles: Record<string, string>;
}

/**
 * Matches a tool name against a single pattern:
 *   "*"      → every tool
 *   "fs.*"   → every tool whose name starts with "fs."
 *   "fs.read" → exactly that tool
 */
export function matchToolPattern(pattern: string, toolName: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return pattern === toolName;
}

/**
 * The tool-name patterns a user may use under a policy.
 *
 * Fail-closed / least privilege: an unknown user — or a user mapped to a role
 * that is not defined — gets an empty pattern list, i.e. no tools at all. A
 * misconfigured mapping can therefore only ever *narrow* access, never widen
 * it, which is the safe default for an access-control primitive.
 */
export function allowedPatternsForUser(policy: ToolPolicy, userId: string): string[] {
  const role = policy.userRoles[userId];
  if (role === undefined) return [];
  return policy.roles[role] ?? [];
}

/** Whether a specific user may use a specific tool under the policy. */
export function isToolAllowed(policy: ToolPolicy, userId: string, toolName: string): boolean {
  return allowedPatternsForUser(policy, userId).some((pattern) => matchToolPattern(pattern, toolName));
}

/**
 * Filters a tool list down to what the user's role allows. Without a policy
 * every tool is returned unchanged (no breaking change to existing servers).
 */
export function filterToolsForUser<T extends { name: string }>(
  policy: ToolPolicy | undefined,
  userId: string,
  tools: T[],
): T[] {
  if (!policy) return tools;
  return tools.filter((tool) => isToolAllowed(policy, userId, tool.name));
}

/** Role names that may use a given tool — for the VVT report's rbacRoles column. */
export function rolesForTool(policy: ToolPolicy, toolName: string): string[] {
  return Object.keys(policy.roles)
    .filter((role) => (policy.roles[role] ?? []).some((pattern) => matchToolPattern(pattern, toolName)))
    .sort();
}

/** Human-readable effective role for the audit run_start line (Art. 5(2) accountability). */
export function effectiveRole(policy: ToolPolicy | undefined, userId: string): string {
  if (!policy) return "(keine Policy — alle Tools)";
  return policy.userRoles[userId] ?? "(unbekannter User — least privilege)";
}

/** Structural validation for policy loaded from env/file — fail fast on garbage. */
export function assertToolPolicy(value: unknown): asserts value is ToolPolicy {
  if (typeof value !== "object" || value === null) {
    throw new Error("TOOL_POLICY must be a JSON object");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.roles !== "object" || obj.roles === null) {
    throw new Error("TOOL_POLICY.roles (roleName -> string[]) is required");
  }
  if (typeof obj.userRoles !== "object" || obj.userRoles === null) {
    throw new Error("TOOL_POLICY.userRoles (userId -> roleName) is required");
  }
  for (const [role, patterns] of Object.entries(obj.roles as Record<string, unknown>)) {
    if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== "string")) {
      throw new Error(`TOOL_POLICY.roles["${role}"] must be an array of tool-name patterns`);
    }
  }
  for (const [user, role] of Object.entries(obj.userRoles as Record<string, unknown>)) {
    if (typeof role !== "string") {
      throw new Error(`TOOL_POLICY.userRoles["${user}"] must be a role name (string)`);
    }
  }
}
