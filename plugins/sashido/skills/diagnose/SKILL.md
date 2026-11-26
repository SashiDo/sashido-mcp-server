---
name: diagnose
description: Find why an app on SashiDo is slow, failing, restarting or behaving differently, from its metrics, errors, deployments and the server code that really runs. Use when the person says "it's slow", "it crashed", "it keeps restarting", "users get an error", "it worked yesterday", "what changed?", "do I need a bigger engine?", or pastes an error from their backend. Reads only; fixes only when asked.
---

# What is wrong with my app

Find the cause, show the evidence, say what would fix it. Follow the rules in the `backend` skill. Here the person usually knows their stack, so file names, line numbers and numbers with units are welcome; keep the conclusion in plain words.

Everything in steps 1 to 3 only reads, and works with a read-only token.

## 1. Get the facts

Start from what the person reported, and get the time it started if they know it.

- **Slow, restarting, out of memory, "do I need a bigger engine"**: `get_process_metrics` first. It shows CPU, memory, event loop lag and restarts over time, the limits, and what stands out.
- **An error, something fails**: `get_error_logs` first. An error names the function or the kind of data and the message.
- **"It worked before", "what changed"**: `get_deployment_info` first. It shows what started each deployment (a build and its commit, a setting, an environment variable) and who.
- **Not answering at all**: `check_app_health`, then `list_builds` and `get_build_log` if the last build failed.

Then get the other two. The answer is almost always where they meet.

## 2. Line them up in time

Put on one timeline: when the symptom started (metrics, first error), and what changed just before (deployments, settings, scaling). Use `get_audit_log` when you need who did something and through what.

Typical pictures:

| What you see | Likely cause |
|---|---|
| Memory climbs steadily after a deploy and never comes down; restarts at the limit | A leak in the code of that deploy |
| CPU at the limit, event loop lag high, in step with traffic | Too little engine for the load, or one heavy operation |
| Event loop lag high with CPU low | Something blocking: a synchronous call, a huge query result |
| Errors start exactly at a deployment | That deployment: its commit or its changed setting |
| Restarts with no memory growth | A crash: the error log has the stack |
| Nothing changed on our side, errors on calls to another service | That service, or its key in the environment variables |

No change near the start is also a finding: say it, and look at load and data growth.

## 3. Read the code that really runs

`list_cloud_files`, then `read_cloud_code` for the file the error or the deploy points to. This is the deployed code, which can differ from the local checkout: if they differ, that itself may be the answer.

Find the lines. If you can reproduce it safely with `call_cloud_function`, do it only when the function changes nothing, or ask first.

## 4. Answer

Cause, evidence, fix, and what would not help:

> **A memory leak, since yesterday's 14:20 deploy.**
> Memory went from 412 MB to 947 MB and never came down; the app restarted twice overnight.
> The cause is in `cloud/functions.js`, line 88: a list that grows with every request.
> A bigger engine would only buy time. I can fix the line.

If you are not sure, say what you know, what you suspect and what would confirm it. Don't present a guess as the cause.

## 5. Fix, if asked

- **In the code**: change it in the repository. It goes live with a push; then `wait_for_deployment`, and look at the same metric or error again after a few minutes to see that it is gone. Say what you saw.
- **A bigger engine, more instances, high availability**: these change the bill and only the app's owner can do them. Say what it would change and that the bill changes with it, and ask before calling them. Recommend them only when the evidence is load, not a fault in the code.
- **A restart** (`deploy_app`) clears a leak for a while and fixes nothing. Offer it as a stopgap, and say that it is one.
