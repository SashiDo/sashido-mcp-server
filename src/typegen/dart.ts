import { ClassModel, Field, isIdentifier, targetName } from "./model.js";

// parse_server_sdk (Flutter / Dart): a ParseObject subclass per class with
// typed getters and setters, and clone() so queries return the subclass.
// Register them with Parse().initialize(..., registeredSubClassMap: {...}).

function dartType(field: Field): string {
  switch (field.type) {
    case "String":
    case "Bytes":
      return "String";
    case "Number":
      return "num";
    case "Boolean":
      return "bool";
    case "Date":
      return "DateTime";
    case "Object":
      return "Map<String, dynamic>";
    case "Array":
      return "List<dynamic>";
    case "File":
      return "ParseFileBase";
    case "GeoPoint":
      return "ParseGeoPoint";
    case "Polygon":
      return "List<dynamic>";
    case "Pointer":
      return targetName(field, "ParseObject");
    case "ACL":
      return "ParseACL";
    default:
      return "dynamic";
  }
}

function accessors(field: Field): string[] {
  const k = `'${field.name.replace(/'/g, "\\'")}'`;
  const name = isIdentifier(field.name) && !/^_/.test(field.name) ? field.name : `field${field.name.replace(/[^A-Za-z0-9]/g, "")}`;
  if (field.type === "Relation") {
    return [`  ParseRelation<${targetName(field, "ParseObject")}> get ${name} => getRelation<${targetName(field, "ParseObject")}>(${k});`];
  }
  const type = dartType(field);
  return [
    `  ${type}? get ${name} => get<${type}>(${k});`,
    `  set ${name}(${type}? value) => set<${type}?>(${k}, value);`,
  ];
}

function subclass(model: ClassModel): string[] {
  const t = model.typeName;
  const lines =
    model.builtIn === "User"
      ? [
          `class ${t} extends ParseUser implements ParseCloneable {`,
          `  ${t}(String? username, String? password, String? emailAddress) : super(username, password, emailAddress);`,
          `  ${t}.clone() : this(null, null, null);`,
        ]
      : model.builtIn === "Installation"
        ? [`class ${t} extends ParseInstallation implements ParseCloneable {`, `  ${t}() : super();`, `  ${t}.clone() : this();`]
        : [
            `class ${t} extends ParseObject implements ParseCloneable {`,
            `  ${t}() : super('${model.className}');`,
            `  ${t}.clone() : this();`,
          ];
  lines.push("", "  @override", `  ${t} clone(Map<String, dynamic> map) => ${t}.clone()..fromJson(map);`);
  for (const f of model.fields) {
    lines.push("", ...accessors(f));
  }
  lines.push("}");
  return lines;
}

export function dart(models: ClassModel[], header: string): string {
  const register = models
    .filter((m) => !m.builtIn)
    .map((m) => `'${m.className}': (_) => ${m.typeName}()`)
    .join(", ");
  const out = [
    `// ${header}`,
    `// Parse().initialize(..., registeredSubClassMap: {${register}})`,
    "import 'package:parse_server_sdk/parse_server_sdk.dart';",
    "",
  ];
  for (const model of models) {
    out.push(...subclass(model), "");
  }
  return out.join("\n");
}
