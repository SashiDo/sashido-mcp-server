import type { ParseSchema } from "../client/parse.js";

/**
 * The security checks of the app servers' GET /app_checks (Parse Server
 * 6.5.11+ on SashiDo) that
 * need only the schema, for apps on older versions; same wording, so the
 * advice reads the same everywhere.
 */

export type CheckState = "ok" | "warning" | "fail" | "error";

export interface CheckResult {
  id: string;
  title: string;
  state: CheckState;
  message: string;
  solution?: string;
}

const CHECKED_SYSTEM_CLASSES = ["_User"];
const MAX_CLASSES = 50;
const PUBLIC_KEYS = "Your client keys are public, anyone can read them from your web app or your mobile app. ";

type Clp = Record<string, Record<string, boolean> | undefined> | undefined;

// a class-level permission is public when it isn't set or allows everyone
function isPublic(clp: Clp, operation: string): boolean {
  return !clp || !clp[operation] || clp[operation]!["*"] === true;
}

function checkedClasses(classes: ParseSchema[]): ParseSchema[] {
  return classes.filter((c) => !c.className.startsWith("_") || CHECKED_SYSTEM_CLASSES.includes(c.className));
}

function classList(names: string[]): string {
  const shown = names.slice(0, MAX_CLASSES);
  const more = names.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
}

const clpOf = (c: ParseSchema) => c.classLevelPermissions as Clp;

function userListing(classes: ParseSchema[]): CheckResult {
  const user = classes.find((c) => c.className === "_User");
  const base = { id: "public-user-find", title: "Public listing of users" };
  if (!user || !isPublic(clpOf(user), "find")) {
    return { ...base, state: "ok", message: "The users can't be listed by everyone." };
  }
  return {
    ...base,
    state: "warning",
    message: `${PUBLIC_KEYS}So anyone can list the users of your app and read their public fields (e.g. usernames).`,
    solution:
      "In the Data Browser open _User > Security and allow Find only for authenticated users, roles or the master key. Sign up, login and fetching the current user keep working.",
  };
}

function addField(classes: ParseSchema[]): CheckResult {
  const open = checkedClasses(classes)
    .filter((c) => isPublic(clpOf(c), "addField"))
    .map((c) => c.className);
  const base = { id: "public-add-field", title: "Adding fields from the clients" };
  if (!open.length) {
    return { ...base, state: "ok", message: "The clients can't add new fields to the classes." };
  }
  return {
    ...base,
    state: "warning",
    message: `${PUBLIC_KEYS}So anyone can add new fields to ${open.length} classes by saving objects with new keys: ${classList(open)}. It is a risk when your cloud code trusts fields like isAdmin.`,
    solution:
      "In the Data Browser open the class > Security and turn off Add Field for the public. You can still add fields from the dashboard and with the master key.",
  };
}

function publicWrite(classes: ParseSchema[]): CheckResult {
  const open = checkedClasses(classes)
    .filter((c) => c.className !== "_User")
    .filter((c) => ["create", "update", "delete"].every((op) => isPublic(clpOf(c), op)))
    .map((c) => c.className);
  const base = { id: "public-write", title: "Classes writable by everyone" };
  if (!open.length) {
    return { ...base, state: "ok", message: "No class can be changed by everyone." };
  }
  return {
    ...base,
    state: "fail",
    message: `${PUBLIC_KEYS}So anyone can create objects in ${open.length} classes and change or delete the objects saved without an ACL: ${classList(open)}.`,
    solution:
      "In the Data Browser open the class > Security and allow Create, Update and Delete only for authenticated users, roles or the master key, or make sure every object is saved with an ACL (e.g. set it in a beforeSave trigger).",
  };
}

export function schemaChecks(classes: ParseSchema[]): CheckResult[] {
  return [userListing(classes), addField(classes), publicWrite(classes)];
}
