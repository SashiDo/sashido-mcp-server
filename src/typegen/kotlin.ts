import { ClassModel, Field, isIdentifier, targetName } from "./model.js";

// The Parse Android SDK: a ParseObject subclass per class with typed
// properties over get/put. Register each with ParseObject.registerSubclass
// before Parse.initialize.

const BASE: Record<string, string> = {
  User: "ParseUser",
  Role: "ParseRole",
  Installation: "ParseInstallation",
};

/** [type, getter] for a field; null when only a getter makes sense */
function kotlinType(field: Field): { type: string; get: string; settable: boolean } {
  const k = JSON.stringify(field.name);
  switch (field.type) {
    case "String":
    case "Bytes":
      return { type: "String?", get: `getString(${k})`, settable: true };
    case "Number":
      return { type: "Number?", get: `getNumber(${k})`, settable: true };
    case "Boolean":
      return { type: "Boolean?", get: `if (has(${k})) getBoolean(${k}) else null`, settable: true };
    case "Date":
      return { type: "Date?", get: `getDate(${k})`, settable: true };
    case "Object":
      return { type: "Map<String, Any?>?", get: `getMap<Any?>(${k})`, settable: true };
    case "Array":
      return { type: "List<Any?>?", get: `getList<Any?>(${k})`, settable: true };
    case "File":
      return { type: "ParseFile?", get: `getParseFile(${k})`, settable: true };
    case "GeoPoint":
      return { type: "ParseGeoPoint?", get: `getParseGeoPoint(${k})`, settable: true };
    case "Polygon":
      return { type: "ParsePolygon?", get: `getParsePolygon(${k})`, settable: true };
    case "Pointer":
      return { type: `${targetName(field, "ParseObject")}?`, get: `getParseObject(${k}) as ${targetName(field, "ParseObject")}?`, settable: true };
    case "Relation":
      return { type: `ParseRelation<${targetName(field, "ParseObject")}>`, get: `getRelation(${k})`, settable: false };
    case "ACL":
      return { type: "ParseACL?", get: `getACL()`, settable: false };
    default:
      return { type: "Any?", get: `get(${k})`, settable: true };
  }
}

function property(field: Field): string[] {
  const { type, get, settable } = kotlinType(field);
  const name = isIdentifier(field.name) ? field.name : `\`${field.name.replace(/`/g, "")}\``;
  const lines = [`    ${settable ? "var" : "val"} ${name}: ${type}`, `        get() = ${get}`];
  if (settable) {
    const k = JSON.stringify(field.name);
    lines.push(`        set(value) { if (value == null) remove(${k}) else put(${k}, value) }`);
  }
  return lines;
}

function subclass(model: ClassModel): string[] {
  const base = model.builtIn ? BASE[model.builtIn]! : "ParseObject";
  const lines = [`@ParseClassName(${JSON.stringify(model.className)})`];
  if (!model.fields.length) {
    lines.push(`class ${model.typeName} : ${base}()`);
    return lines;
  }
  lines.push(`class ${model.typeName} : ${base}() {`);
  model.fields.forEach((f, i) => {
    if (i) {
      lines.push("");
    }
    lines.push(...property(f));
  });
  lines.push("}");
  return lines;
}

export function kotlin(models: ClassModel[], header: string): string {
  const out = [
    `// ${header}`,
    "// Register before Parse.initialize: " +
      models.map((m) => `ParseObject.registerSubclass(${m.typeName}::class.java)`).join("; "),
    "import com.parse.*",
    "import java.util.Date",
    "",
  ];
  for (const model of models) {
    out.push(...subclass(model), "");
  }
  return out.join("\n");
}
