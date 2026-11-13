import { ClassModel, Field, isIdentifier, targetName } from "./model.js";

// ParseSwift: a struct per class conforming to ParseObject (ParseUser,
// ParseRole, ParseInstallation for the built-in classes).

const PROTOCOL: Record<string, string> = {
  User: "ParseUser",
  Role: "ParseRole",
  Installation: "ParseInstallation",
};

// what the protocols require besides the common fields
const REQUIRED_VARS: Record<string, string[]> = {
  User: [
    "var username: String?",
    "var email: String?",
    "var emailVerified: Bool?",
    "var password: String?",
    "var authData: [String: [String: String]?]?",
  ],
  Role: ["var name: String?"],
  Installation: [
    "var installationId: String?",
    "var deviceType: String?",
    "var deviceToken: String?",
    "var badge: Int?",
    "var timeZone: String?",
    "var channels: [String]?",
    "var appName: String?",
    "var appIdentifier: String?",
    "var appVersion: String?",
    "var parseVersion: String?",
    "var localeIdentifier: String?",
  ],
};

function swiftType(field: Field): string | null {
  switch (field.type) {
    case "String":
    case "Bytes":
      return "String";
    case "Number":
      return "Double";
    case "Boolean":
      return "Bool";
    case "Date":
      return "Date";
    case "Object":
      return "[String: AnyCodable]";
    case "Array":
      return "[AnyCodable]";
    case "File":
      return "ParseFile";
    case "GeoPoint":
      return "ParseGeoPoint";
    case "Polygon":
      return "ParsePolygon";
    case "Pointer":
      // Pointer<T> needs the target's struct: generate it too (classes)
      return field.targetGenerated ? `Pointer<${targetName(field, "")}>` : null;
    case "ACL":
      return "ParseACL";
    default:
      // relations aren't stored properties in ParseSwift: use
      // object.relation("<field>", child: ...) instead
      return null;
  }
}

function struct(model: ClassModel): string[] {
  const protocol = model.builtIn ? PROTOCOL[model.builtIn]! : "ParseObject";
  const lines = [
    ...(model.builtIn ? [] : [`// Parse class ${JSON.stringify(model.className)}`]),
    `struct ${model.typeName}: ${protocol} {`,
    "    var originalData: Data?",
    "    var objectId: String?",
    "    var createdAt: Date?",
    "    var updatedAt: Date?",
    "    var ACL: ParseACL?",
    ...(REQUIRED_VARS[model.builtIn || ""] || []).map((v) => `    ${v}`),
  ];
  if (!model.builtIn) {
    lines.splice(1, 0, `    static var className: String { ${JSON.stringify(model.className)} }`);
  }
  for (const f of model.fields) {
    const type = swiftType(f);
    if (!type && f.type === "Pointer") {
      lines.push(`    // ${f.name}: Pointer to ${f.target} - generate ${f.target} too for Pointer<...>`);
    } else if (!type) {
      lines.push(`    // ${f.name}: Relation<${targetName(f, f.target || "ParseObject")}> - use relation("${f.name}", child: ...)`);
    } else if (!isIdentifier(f.name)) {
      lines.push(`    // ${JSON.stringify(f.name)}: ${type} - not a Swift identifier, map it with CodingKeys`);
    } else {
      lines.push(`    var ${f.name}: ${type}?`);
    }
  }
  lines.push("}");
  return lines;
}

export function swift(models: ClassModel[], header: string): string {
  const out = [`// ${header}`, "import Foundation", "import ParseSwift", ""];
  for (const model of models) {
    out.push(...struct(model), "");
  }
  return out.join("\n");
}
