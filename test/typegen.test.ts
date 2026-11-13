import { describe, expect, it } from "vitest";
import ts from "typescript";
import { buildModel, typeNameOf } from "../src/typegen/model.js";
import { typescript } from "../src/typegen/typescript.js";
import { swift } from "../src/typegen/swift.js";
import { kotlin } from "../src/typegen/kotlin.js";
import { dart } from "../src/typegen/dart.js";
import type { ParseSchema } from "../src/client/parse.js";

const common = {
  objectId: { type: "String" },
  createdAt: { type: "Date" },
  updatedAt: { type: "Date" },
  ACL: { type: "ACL" },
};

const SCHEMAS: ParseSchema[] = [
  {
    className: "_User",
    fields: { ...common, username: { type: "String" }, password: { type: "String" }, email: { type: "String" }, nickname: { type: "String" } },
  },
  {
    className: "blog-post",
    fields: {
      ...common,
      title: { type: "String", required: true } as never,
      views: { type: "Number" },
      published: { type: "Boolean" },
      publishedAt: { type: "Date" },
      meta: { type: "Object" },
      tags: { type: "Array" },
      cover: { type: "File" },
      place: { type: "GeoPoint" },
      area: { type: "Polygon" },
      author: { type: "Pointer", targetClass: "_User" },
      likes: { type: "Relation", targetClass: "_User" },
      "odd name": { type: "String" },
    },
  },
  { className: "_Session", fields: { ...common, sessionToken: { type: "String" } } },
  { className: "_PushStatus", fields: { ...common } },
];

describe("type generation", () => {
  const models = buildModel(SCHEMAS);
  const header = "Generated for tests";

  it("models the app's classes, leaving out the platform's and the SDKs' fields", () => {
    expect(models.map((m) => m.className)).toEqual(["blog-post", "_User"]);
    expect(typeNameOf("blog-post")).toBe("BlogPost");
    const user = models.find((m) => m.className === "_User")!;
    expect(user.fields.map((f) => f.name)).toEqual(["nickname"]);
    const post = models.find((m) => m.className === "blog-post")!;
    expect(post.fields.find((f) => f.name === "title")!.required).toBe(true);
    expect(buildModel(SCHEMAS, ["_Session"]).map((m) => m.className)).toEqual(["_Session"]);
  });

  it("TypeScript: attributes and registered subclasses, valid syntax", () => {
    const code = typescript(models, header);
    expect(code).toContain("title: string;");
    expect(code).toContain("views?: number;");
    expect(code).toContain("author?: User;");
    expect(code).toContain("likes?: Parse.Relation<Parse.Object, User>;");
    expect(code).toContain('"odd name"?: string;');
    expect(code).toContain('Parse.Object.registerSubclass("blog-post", BlogPost);');
    expect(code).toContain("export class User extends Parse.User<UserAttributes> {}");
    const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
    expect(out.diagnostics).toEqual([]);
  });

  it("Swift: ParseObject structs with pointers, relations as notes", () => {
    const code = swift(models, header);
    expect(code).toContain("struct BlogPost: ParseObject {");
    expect(code).toContain('static var className: String { "blog-post" }');
    expect(code).toContain("var author: Pointer<User>?");
    expect(code).toContain("var cover: ParseFile?");
    expect(code).toContain('// likes: Relation<User> - use relation("likes", child: ...)');
    expect(code).toContain("struct User: ParseUser {");
    expect(code).toContain("var emailVerified: Bool?");
    expect(code).toContain("var nickname: String?");
  });

  it("Kotlin: ParseObject subclasses with typed properties", () => {
    const code = kotlin(models, header);
    expect(code).toContain('@ParseClassName("blog-post")');
    expect(code).toContain("class BlogPost : ParseObject() {");
    expect(code).toContain('get() = getParseObject("author") as User?');
    expect(code).toContain('val likes: ParseRelation<User>');
    expect(code).toContain('set(value) { if (value == null) remove("views") else put("views", value) }');
    expect(code).toContain("class User : ParseUser() {");
    expect(code).toContain("var `odd name`: String?");
  });

  it("Dart: ParseObject subclasses with clone and accessors", () => {
    const code = dart(models, header);
    expect(code).toContain("class BlogPost extends ParseObject implements ParseCloneable {");
    expect(code).toContain("  BlogPost() : super('blog-post');");
    expect(code).toContain("  User? get author => get<User>('author');");
    expect(code).toContain("  set views(num? value) => set<num?>('views', value);");
    expect(code).toContain("ParseRelation<User> get likes => getRelation<User>('likes');");
    expect(code).toContain("class User extends ParseUser implements ParseCloneable {");
    expect(code).toContain("registeredSubClassMap: {'blog-post': (_) => BlogPost()}");
    expect(code).toContain("String? get fieldoddname => get<String>('odd name');");
  });
});

describe("type generation for some classes", () => {
  // CartItems points to Carts, which isn't generated
  const schemas: ParseSchema[] = [
    { className: "CartItems", fields: { cart: { type: "Pointer", targetClass: "Carts" }, qty: { type: "Number" } } },
    { className: "Carts", fields: { total: { type: "Number" } } },
  ];
  const models = buildModel(schemas, ["CartItems"]);

  it("points to the SDK's base type when the target isn't generated", () => {
    expect(typescript(models, "h")).toContain("cart?: Parse.Object;");
    expect(kotlin(models, "h")).toContain('get() = getParseObject("cart") as ParseObject?');
    expect(dart(models, "h")).toContain("ParseObject? get cart => get<ParseObject>('cart');");
    expect(swift(models, "h")).toContain("// cart: Pointer to Carts - generate Carts too for Pointer<...>");
    expect(typescript(buildModel(schemas), "h")).toContain("cart?: Carts;");
  });
});
