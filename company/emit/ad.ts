/**
 * Active Directory and NTFS exports, as an IT-Leiter would produce them:
 * a Get-ADUser dump, a group dump, and an icacls-style permission list.
 *
 * These CSVs are the raw material for the ACL delta report. The report DERIVES the GDPR
 * findings from them; nothing here is flagged as a violation.
 */
import { COMPANY } from "../seed.config.js";
import type { AclEntry, AdGroup, Employee, Share } from "../model/types.js";

export function buildUsersCsv(employees: readonly Employee[]): string {
  const rows = ["SamAccountName;DisplayName;Mail;Department;Enabled;WhenCreated"];
  for (const e of employees) {
    rows.push([
      e.samAccountName,
      `${e.lastName}, ${e.firstName}`,
      e.email,
      e.department,
      e.leftIso ? "False" : "True",
      e.hiredIso,
    ].join(";"));
  }
  return rows.join("\r\n");
}

export function buildGroupsCsv(groups: readonly AdGroup[]): string {
  const rows = ["Group;Description;MemberCount;Members"];
  for (const group of groups) {
    rows.push([
      group.name,
      group.description,
      String(group.memberIds.length),
      // Truncated exactly as a real export would be, to keep the file readable.
      group.memberIds.slice(0, 12).join("|") + (group.memberIds.length > 12 ? "|..." : ""),
    ].join(";"));
  }
  return rows.join("\r\n");
}

export function buildAclsCsv(acls: readonly AclEntry[], shares: readonly Share[]): string {
  const share = shares[0];
  if (!share) throw new Error("no share defined");
  const rows = ["Path;IdentityReference;FileSystemRights;Inherited"];
  for (const acl of acls) {
    const rights = acl.right === "full" ? "FullControl" : acl.right === "modify" ? "Modify" : "ReadAndExecute";
    rows.push([
      `${share.driveLetter}\\${acl.path.replace(/\//g, "\\")}`,
      `${COMPANY.netbiosDomain}\\${acl.group}`,
      rights,
      "False",
    ].join(";"));
  }
  return rows.join("\r\n");
}
