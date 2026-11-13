import type { ParseSchema } from "../client/parse.js";

/**
 * An app's schema as the generators need it: classes with typed fields,
 * the SDKs' own fields left out (objectId, createdAt, updatedAt, ACL, and
 * the user's username, password, ...), names usable as identifiers.
 */

export type FieldType =
  | "String"
  | "Number"
  | "Boolean"
  | "Date"
  | "Object"
  | "Array"
  | "File"
  | "GeoPoint"
  | "Polygon"
  | "Pointer"
  | "Relation"
  | "Bytes"
  | "ACL";

export interface Field {
  /** As stored in Parse */
  name: string;
  type: FieldType;
  /** Pointers and relations: the class they point to */
  target?: string;
  /** The target is among the generated classes (else: the SDK's base type) */
  targetGenerated?: boolean;
  required: boolean;
}

export interface ClassModel {
  /** As stored in Parse, e.g. _User */
  className: string;
  /** The type's name, e.g. User */
  typeName: string;
  /** _User, _Role, _Installation: the SDKs' own classes */
  builtIn?: "User" | "Role" | "Installation";
  fields: Field[];
}

const BUILT_IN_CLASSES: Record<string, ClassModel["builtIn"]> = {
  _User: "User",
  _Role: "Role",
  _Installation: "Installation",
};

// every Parse object has these; the SDKs declare them
const COMMON_FIELDS = ["objectId", "createdAt", "updatedAt", "ACL"];
// and these on the built-in classes
const BUILT_IN_FIELDS: Record<string, string[]> = {
  _User: ["username", "password", "email", "emailVerified", "authData"],
  _Role: ["name", "users", "roles"],
  _Installation: [
    "installationId",
    "deviceType",
    "deviceToken",
    "channels",
    "badge",
    "timeZone",
    "localeIdentifier",
    "appIdentifier",
    "appName",
    "appVersion",
    "parseVersion",
    "pushType",
    "GCMSenderId",
  ],
};

// classes of the platform, not of the app's data model
const INTERNAL = /^_(?!User$|Role$|Installation$)/;

/** "my-class" -> "MyClass", "_User" -> "User" */
export function typeNameOf(className: string): string {
  const builtIn = BUILT_IN_CLASSES[className];
  if (builtIn) {
    return builtIn;
  }
  const words = className.replace(/^_+/, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return /^[0-9]/.test(name) ? `Class${name}` : name || "Unnamed";
}

/** A field name usable as an identifier in all four languages */
export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function buildModel(schemas: ParseSchema[], only?: string[]): ClassModel[] {
  const wanted = only && only.length ? new Set(only) : null;
  const models: ClassModel[] = schemas
    .filter((s) => (wanted ? wanted.has(s.className) : !INTERNAL.test(s.className)))
    .map((s) => {
      const skip = new Set([...COMMON_FIELDS, ...(BUILT_IN_FIELDS[s.className] || [])]);
      const fields = Object.entries(s.fields)
        .filter(([name]) => !skip.has(name))
        .map(([name, def]): Field => ({
          name,
          type: def.type as FieldType,
          target: def.targetClass,
          required: !!(def as { required?: boolean }).required,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        className: s.className,
        typeName: typeNameOf(s.className),
        builtIn: BUILT_IN_CLASSES[s.className],
        fields,
      };
    })
    .sort((a, b) => a.typeName.localeCompare(b.typeName));
  const generated = new Set(models.map((m) => m.className));
  for (const model of models) {
    for (const field of model.fields) {
      field.targetGenerated = !!field.target && generated.has(field.target);
    }
  }
  return models;
}

/**
 * The type name for a pointer or relation's target, or the SDK's base type
 * when the target isn't generated (e.g. left out with `classes`)
 */
export function targetName(field: Field, base: string): string {
  return field.target && field.targetGenerated ? typeNameOf(field.target) : base;
}
