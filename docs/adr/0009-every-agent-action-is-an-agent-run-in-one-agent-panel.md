# Every Agent Action Is an Agent Run in One Agent Panel

Agent work had grown four unrelated surfaces: embedded `Agent Session` workbenches, background pipeline tasks with their own stream drawer, a top-bar indicator, and synchronous calls that showed only a spinner and a toast (prototype refinement among them, which exposed no agent activity at all). We decided that every piece of agent work in the workbench, whether started by typing or by pressing a button on a canvas, is an `Agent Run` inside an `Agent Session`, and that all runs are shown in one shell-level `Agent Panel` with a single run-card format. This extends ADR 0007 from the five conversational workflows to every agent call, and adds `Prototype Co-Design` as a sixth session kind.

Sessions belong to one specialised agent within one `Ontology Project`, because each agent has its own tools and context; a session never mixes agents. Within that scope the user may keep several sessions per agent and switch, rename, or delete them from the `Agent Panel`, so that an unrelated topic does not have to continue an old conversation. Canvas actions post to the session the panel is showing for that agent. The one exception is `Prototype Co-Design`, where each `Interactive Prototype` owns its own session and forks it when the prototype is saved as a new one, since a conversation about one design direction is noise for another; those sessions are not created or deleted by hand. A session runs one `Agent Run` at a time and queues further input; different sessions may run concurrently.

## Considered Options

- **Keep background pipeline tasks as a second mechanism and only restyle them.** Rejected: two mechanisms means two streaming protocols, two cancel and retry paths, and two places for the user to look, which is the fragmentation being removed.
- **One project-wide conversation for all agents.** Rejected: specialised agents would share one context and pollute each other, and it contradicts the per-agent sessions of ADR 0007.
- **A panel per module.** Rejected: the user would have to relearn where the agent lives in each module, and long runs would be lost on navigation.

## Consequences

- Canvas buttons such as "Synthesize SRS" or "Generate prototype" remain, but each posts a structured instruction to the owning session instead of calling a one-shot endpoint.
- The pipeline-task endpoints and the one-shot agent endpoints are retired once their callers have moved, so resumability and cancellation have to be provided by the session engine alone.
- A failed run is reported as failed in the panel. No agent path may substitute a template result and report success outside the explicit Mock mode of ADR 0007.

## Amendments

- **2026-11-13: several sessions per agent.** The original text kept exactly one session per specialised agent per project. In use that forced every topic into one ever-growing conversation, so the panel now offers session management for every agent except `Prototype Co-Design`. The reasons for per-agent sessions and for one shared panel are unchanged.
