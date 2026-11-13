import { ClassModel, Field, isIdentifier, targetName } from "./model.js";

// The Parse JavaScript SDK (parse, with its bundled types): typed attributes
// and a subclass per class, registered so queries return it.

const SDK_CLASS: Record<string, string> = {
  User: "Parse.User",
  Role: "Parse.Role",
  Installation: "Parse.Installation",
};

function tsType(field: Field): string {
  switch (field.type) {
    case "String":
      return "string";
    case "Number":
      return "number";
    case "Boolean":
      return "boolean";
    case "Date":
      return "Date";
    case "Object":
      return "Record<string, unknown>";
    case "Array":
      return "unknown[]";
    case "File":
      return "Parse.File";
    case "GeoPoint":
      return "Parse.GeoPoint";
    case "Polygon":
      return "Parse.Polygon";
    case "Pointer":
      return targetName(field, "Parse.Object");
    case "Relation":
      return `Parse.Relation<Parse.Object, ${targetName(field, "Parse.Object")}>`;
    case "ACL":
      return "Parse.ACL";
    default:
      return "string";
  }
}

function attributes(model: ClassModel): string[] {
  const lines = [`export interface ${model.typeName}Attributes {`];
  for (const f of model.fields) {
    const key = isIdentifier(f.name) ? f.name : JSON.stringify(f.name);
    lines.push(`  ${key}${f.required ? "" : "?"}: ${tsType(f)};`);
  }
  lines.push("}");
  return lines;
}

function subclass(model: ClassModel): string[] {
  const base = model.builtIn ? SDK_CLASS[model.builtIn]! : `Parse.Object<${model.typeName}Attributes>`;
  if (model.builtIn) {
    // the SDK's own class, with this app's fields
    return [
      `export class ${model.typeName} extends ${base}<${model.typeName}Attributes> {}`,
      `Parse.Object.registerSubclass(${JSON.stringify(model.className)}, ${model.typeName});`,
    ];
  }
  return [
    `export class ${model.typeName} extends ${base} {`,
    `  constructor(attributes?: ${model.typeName}Attributes) {`,
    `    super(${JSON.stringify(model.className)}, attributes as ${model.typeName}Attributes);`,
    "  }",
    "}",
    `Parse.Object.registerSubclass(${JSON.stringify(model.className)}, ${model.typeName});`,
  ];
}

export function typescript(models: ClassModel[], header: string): string {
  const out = [`// ${header}`, 'import Parse from "parse";', ""];
  for (const model of models) {
    out.push(...attributes(model), "", ...subclass(model), "");
  }
  return out.join("\n");
}
