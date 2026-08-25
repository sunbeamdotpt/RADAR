import { parseSemver } from "./version.ts";

/**
 * Layer 1: structured data diffing — the highest-confidence signals.
 * Data (helm values schemas, CRD manifests, go.mod files) is injected by the
 * caller; acquisition is out of scope for the engine itself.
 */

export interface SchemaChange {
  path: string;
  change_type: string;
  severity: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function walkSchema(
  old: unknown,
  newVal: unknown,
  path: string,
  cb: (p: string, o: unknown, n: unknown) => void,
): void {
  if (isPlainObject(old) && isPlainObject(newVal)) {
    const allKeys = new Set([...Object.keys(old), ...Object.keys(newVal)]);
    for (const k of allKeys) {
      const childPath = path ? `${path}.${k}` : k;
      cb(childPath, old[k], newVal[k]);
      // Arrays (enum, required) are leaves — index paths like `enum.1` are noise.
      if (k in old && k in newVal && isPlainObject(old[k])) {
        walkSchema(old[k], newVal[k], childPath, cb);
      }
    }
  }
}

/** Diff two helm values.schema.json documents. */
export function diffHelmValuesSchema(
  oldSchema: Record<string, unknown>,
  newSchema: Record<string, unknown>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const visit = (p: string, oldVal: unknown, newVal: unknown) => {
    if (oldVal !== undefined && newVal === undefined) {
      changes.push({ path: p, change_type: "removed", severity: "breaking" });
      return;
    }
    if (!isPlainObject(oldVal) || !isPlainObject(newVal)) return;
    if (oldVal.type && newVal.type && oldVal.type !== newVal.type) {
      changes.push({ path: p, change_type: "type_changed", severity: "breaking" });
    }
    const oldReq = new Set(Array.isArray(oldVal.required) ? oldVal.required : []);
    const newReq = new Set(Array.isArray(newVal.required) ? newVal.required : []);
    for (const req of newReq) {
      if (!oldReq.has(req)) {
        changes.push({
          path: p ? `${p}.${req}` : String(req),
          change_type: "required_added",
          severity: "breaking",
        });
      }
    }
    const oldEnum = new Set(Array.isArray(oldVal.enum) ? oldVal.enum : []);
    const newEnum = new Set(Array.isArray(newVal.enum) ? newVal.enum : []);
    if (oldEnum.size > 0 && newEnum.size > 0) {
      for (const ev of oldEnum) {
        if (!newEnum.has(ev)) {
          changes.push({ path: p, change_type: "enum_restricted", severity: "breaking" });
          break;
        }
      }
    }
  };
  visit("", oldSchema, newSchema); // the root node has required/enum lists too
  walkSchema(oldSchema, newSchema, "", visit);
  return changes;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}

/** Diff two CRD manifests: removed API versions and newly required fields. */
export function diffCRDManifests(
  oldCRD: Record<string, unknown>,
  newCRD: Record<string, unknown>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const oldSpec = asRecord(oldCRD.spec);
  const newSpec = asRecord(newCRD.spec);
  const oldVersions = (Array.isArray(oldSpec.versions) ? oldSpec.versions : []) as Record<
    string,
    unknown
  >[];
  const newVersions = (Array.isArray(newSpec.versions) ? newSpec.versions : []) as Record<
    string,
    unknown
  >[];
  const oldMap = new Map(oldVersions.map((v) => [String(v.name), v]));
  const newMap = new Map(newVersions.map((v) => [String(v.name), v]));

  for (const [vname] of oldMap) {
    if (!newMap.has(vname)) {
      changes.push({
        path: `versions.${vname}`,
        change_type: "api_version_removed",
        severity: "breaking",
      });
    }
  }
  for (const [vname, newVer] of newMap) {
    const oldVer = oldMap.get(vname);
    if (!oldVer) continue;
    const oldSchema = asRecord(asRecord(oldVer.schema).openAPIV3Schema);
    const newSchema = asRecord(asRecord(newVer.schema).openAPIV3Schema);
    const oldReq = new Set(Array.isArray(oldSchema.required) ? oldSchema.required : []);
    const newReq = new Set(Array.isArray(newSchema.required) ? newSchema.required : []);
    for (const req of newReq) {
      if (!oldReq.has(req)) {
        changes.push({
          path: `versions.${vname}.required.${req}`,
          change_type: "required_field_added",
          severity: "breaking",
        });
      }
    }
  }
  return changes;
}

function parseGoMod(mod: string): Map<string, string> {
  const deps = new Map<string, string>();
  for (const line of mod.split("\n")) {
    const m = line.match(/^\s*(?:require\s+)?(\S+)\s+(v\S+)/);
    if (m) deps.set(m[1], m[2]);
  }
  return deps;
}

/** Diff two go.mod files: removed deps are breaking, major bumps warrant review. */
export function diffGoMod(oldMod: string, newMod: string): SchemaChange[] {
  const oldDeps = parseGoMod(oldMod);
  const newDeps = parseGoMod(newMod);
  const changes: SchemaChange[] = [];
  for (const [modName, oldVer] of oldDeps) {
    const newVer = newDeps.get(modName);
    if (!newVer) {
      changes.push({ path: modName, change_type: "dependency_removed", severity: "breaking" });
      continue;
    }
    const oldV = parseSemver(oldVer);
    const newV = parseSemver(newVer);
    if (oldV && newV && newV.major > oldV.major) {
      changes.push({ path: modName, change_type: "dependency_major_bump", severity: "review" });
    }
  }
  return changes;
}
