# AI

Hearth works fully without AI. If your home runs its own AI server, Hearth can chat with it, show what it's doing, and use it to design widgets. It talks to any server with **Ollama's API** or an **OpenAI-compatible** one (llama.cpp, vLLM, LM Studio, LocalAI and others). Nothing is sent anywhere until the admin adds a server.

## Adding a server

**Settings → AI → Add a server** (the admin):

| Field  | What to put                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------- |
| Kind   | **Ollama**, or **OpenAI-compatible**                                                            |
| URL    | Ollama: `http://192.168.1.20:11434`. OpenAI-compatible: the base, usually ending in `/v1`      |
| Model  | The model chat uses by default, like `llama3.1`                                                 |
| Key    | Only if the server needs one. It's stored encrypted and never shown again                      |

Add as many as you like and choose which one chat starts on. **Who can chat** picks the roles that may use it (adults and the admin by default), and an optional **system prompt** is added to every chat, like "Answer briefly. We live in Ohio."

## Chat

**Chat** in the top bar, for the roles allowed. Pick a server and model, and ask. Answers stream in as they're written.

- **Conversations stay in your browser**, per person. Hearth's server doesn't keep them.
- **Children** can't chat unless the admin allows the child role. When they can, the model is told it's talking with a child, so it keeps answers simple and safe.
- **A busy server:** if a shared server says it's busy, downloading a model, or out of machines, Hearth waits and tells you why, for up to 45 seconds; longer waits are reported with how long.
- **Ask** is a widget with a box that opens the chat with your question.

## AI computers

**AI computers** shows each server at a glance: up or down, how busy, how many models it has, which are loaded, and how fast it answered. The **AI computers** widget puts the same on the start page.

## The widget designer

With a server added, the widget editor's **AI designer** drafts a widget from a sentence and fixes it until it works. See [Widgets](widgets.md#the-ai-designer).

## What's sent

Only to the servers you add, and only when someone chats, opens AI computers, or uses the designer:

- **Chat:** the conversation, the system prompt, and for children a note that they're a child.
- **AI computers:** questions about the server's models and load. No conversation.
- **The designer:** your description, the widget's draft, and samples of what its sources returned, with secrets hidden.
