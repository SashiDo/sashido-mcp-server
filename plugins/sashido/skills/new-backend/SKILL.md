---
name: new-backend
description: Create a working backend on SashiDo for an app from a plain description of what the app does. Use when a web or mobile app has no backend yet and needs accounts, stored data, sharing between users, or the person says "add a backend", "I need a database", "my app needs sign-in", "where do I keep the data". Creates the app, designs what it stores, sets who may see and change what, writes typed models into the project and connects the client.
---

# A backend from a description

The person describes the app. You leave them with a backend that runs, is locked down, and is connected to their project. Follow the rules in the `backend` skill: their words, one plan and one "yes", secrets stay with them, an honest summary at the end.

## 1. Understand what the app needs

Read the project first: the screens, forms and models already there say most of it. From them and from what the person said, work out:

- the things the app stores (people, notes, orders…) and what each one holds;
- who may see and change each thing: everyone, anyone signed in, only its owner, the people it is shared with, an admin.

Ask only what you can't work out, at most two or three questions, in their words. Always worth asking if unknown:

- **Where most of the users are**: Europe, North America, Japan or Australia. It decides where the backend runs and can't be changed later by you.
- Anything about access you would otherwise guess: "can someone a note is shared with edit it, or only read it?"

## 2. Show the plan and wait for "yes"

In plain words, no table of types:

> Here is what I'll set up, in Europe:
> - **People** sign up with email and password.
> - **Notes**: a title, the text, and who wrote it. Only the author sees and changes a note.
> - **Sharing**: a note can be shared with other people, who can read it.
> Nobody can read or add anything without signing in. Shall I go ahead?

Mention that a new app counts toward their plan.

## 3. Build it

1. `create_app` with the name and the region (`eu`, `us`, `jp` or `au`). Use the name the person gave the project; ask if there is none. If the person already has an app for this, or `create_app` is not among your tools (a token limited to some apps can't create one), build in the existing app: `list_apps`, and ask which one if it isn't obvious. Then read what is already there with `list_classes` before adding anything.
2. `create_class` for each thing the app stores, with its fields. Use a pointer to the user for "who wrote it": `{"type": "Pointer", "targetClass": "_User"}`. Don't create a class for people: accounts exist already (`_User`); add fields to it with `add_field` only if needed.
3. `update_class_permissions` on **every** class you created, right away. A new class is open to everyone until you do. The default for an app with accounts: every operation requires a signed-in user, and adding fields from the client is closed. Open something to everyone only when the plan said so.
4. Close the two things every new app leaves open on accounts (`_User`): anyone can list the users, and anyone can add fields to them. With `update_class_permissions` on `_User`, require a signed-in user for `find` and close `addField`; leave the rest as it is, so signing up and signing in keep working. On an app that already has users, look at how the client uses the list of users first, and ask.
5. Check each class with `get_class_permissions`: read back what is really set, don't assume.

### "Only its owner", "only those it is shared with"

Class permissions say which kind of person may do an operation, not which object. Per-object privacy needs each object to carry who may access it (its ACL):

- In the client code you write, set it when the object is saved: readable and writable by the current user, plus read access for the people it is shared with.
- That alone trusts the client. To enforce it on the server, a `beforeSave` rule in the server code sets the owner and the access from the signed-in user, whatever the client sent. Write it only if the app's server code repository is in the workspace or the person can give you its location; it goes live with a push, then `wait_for_deployment`.
- If you could not add the server rule, say so in the summary: "privacy is set by your app when it saves; a rule on the server that enforces it is still to add." Never report it as enforced when it is not.

## 4. Connect the project

1. `generate_types` with the client's language: `typescript`, `swift`, `kotlin` or `dart`. Put the result where the project keeps its models; tell the person the file.
2. The client needs three values, and `get_app` gives all three: the app ID, the client key (the JavaScript key for a web app, the .NET key for Unity) and the API URL (`serverUrl`; `publicServerUrl` if the app has its own domain). Put them where the project keeps configuration (an environment file, following what the project already does), and initialize the Parse SDK once at startup from it. These are public values: every client app is shipped with them. The master key is never given to you and must never be in a client. If `get_app` returns no keys, the person copies them from the SashiDo Dashboard, App Settings › Security & Keys.
3. If the project has no Parse SDK yet, add the one for its platform and say that you did.
4. Write or adjust the sign-up, sign-in and the first save and query against the typed models, if the person asked for working screens.

## 5. Check your own work

Call `get_app_advice`. Fix what it reports about the classes you made. Then, if you can, run the app or a small script: sign up, save one object, read it back, and try to read it without signing in, which must fail.

## 6. Say what is true now

> **Your backend is running** in Europe.
> It stores: people, notes, and who a note is shared with.
> Only signed-in people can use it. A note is visible to its author and to those it is shared with.
> Your project has the typed models in `src/models/` and is connected.
> Checked: signing up, saving a note, and that nobody reads it without signing in.
> Left for you: nothing. You can see the data in the SashiDo Dashboard under Database.

List anything you did not do or could not check.
