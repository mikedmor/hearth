# Getting started

Your first hour with Hearth: set up the admin, add the people in the house, fill the page with your services, and decide who sees what.

## The admin

The first visit asks for the **setup code** from Hearth's log (`docker logs hearth`, or the container's Log tab), then for a password. That's the admin: the person who looks after the house's page. Sign in again later with the key icon at the top right, and out with **Admin ↩**. The key icon only shows on a page with the admin role (and on a new install with nobody set up yet), so tap your own face first.

The admin is a sign-in, not a person. Whoever runs the house usually also has a page of their own, and signs in as the admin only to change the house's things.

## People

Add everyone under **Settings → People**: a name, an emoji or initial, a colour and a role.

| Role         | Sees                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| **Admin**    | Everything for adults and the admin's own things (changing the house's still needs the sign-in) |
| **Adult**    | Everything for everyone and for adults                                                       |
| **Child**    | Only what's for everyone, or picked for them. Their page is always locked. Chat with AI only if you allow it |
| Guest        | Someone who hasn't picked a face: only what's for everyone                                   |

- **Who's here?** Visitors tap their face at the top right. The device stays on that person until they switch.
- **PINs** keep a page private. The admin can set one for anyone; each person can also set their own in **Look → PIN**. Without one, anyone on the network can open that page.
- **Locked pages** (Settings → People) can't be changed by their owner: no links, sections, widgets, favourites or look of their own. **A child's page is always locked**: you set it up for them, and they use it.
- **A set-up link**, like `start.home/?profile=sam`, opens one person's page on a shared device. If they have a PIN, it's still asked for.

## Sections and links

Press **Edit** on the start page. Everything becomes editable, and **Done** puts it back so nothing moves by accident.

- **+ Section** makes a section (a category like Everyday, Media, Home). Its settings button changes its name and who sees it, or deletes it.
- **+ Link** adds a service or bookmark. Type its address and Hearth names the app if it knows it, and offers its logo. Choose a section and who sees it. For the admin, it starts with the **services on your network that have no link yet** (found by the port checks, added on the Devices page, or connected in Setup): one tap fills it in. **Settings → Links** shows the same list.
- **Find services** scans the network and adds the apps you tick (see [Finding services](finding-services.md)).
- **Drag a section by its title bar**, or a widget by its handle (⋮⋮), to reorder your page. Over the top edge of another, it goes before it; over the bottom edge, after it. A line shows where it will land. **Drag a link by its handle** (⋮⋮) to reorder it or move it to another section.
- **Keep things together:** drop a section or widget on the middle of another (**Keep together** shows), or use the chain button (🔗) and pick what it stays next to, like two camera views, or a printer's widget beside the section with its link. Linked ones move as one and stay together on every screen: in one column on a computer, and on a phone a section's linked widgets sit right under it on the Apps page. A dashed box shows each group: drag its **Together** handle to move the whole group, or drag one item to reorder it inside the group or take it out. Dropping between two linked items puts it in their group. On a linked item the chain button unlinks it. A widget's settings button (⚙, for the admin) changes its name and who sees it, a built-in one's options, or deletes it; **Open the designer** there changes what a custom one shows. This works when widgets are mixed in with your sections (**Look → Widgets: Mixed in**, the default).
- **Hide** a section or link from your own page with the crossed-out eye. **Show hidden** in the edit bar brings them back.

Sections and links can belong to the **house** or to **one person**:

- The **house's** are made and changed by the admin, signed in. Edit mode marks them, with a button to sign in.
- **Your own** are made by you, are only on your page, and can go in any section you can see. Anyone whose page isn't locked can have their own.

### Who sees what

Each section and each link has **who can see it**:

| Choice              | Who                                                       |
| ------------------- | --------------------------------------------------------- |
| Everyone            | Every person and guests                                   |
| Adults              | Adults and the admin                                      |
| Only the admin      | The admin                                                 |
| Only some people    | The people you pick, and the admin                        |
| Just me             | Only you: it's your own                                   |

A link that's seen by fewer people than its section gets a small badge in edit mode.

## Getting around

- **Search:** press **Ctrl+K** (or `/`) and type. **Enter** opens the first match, **Ctrl+Enter** opens it in a new tab.
- **Search the web** from the same box: when what you type isn't one of the home's links, **Enter** searches Google (or the engine the admin chose in **Settings → General → Search the web**; each person can pick their own in **Look → Search**). Type an address like `nas.home:5000` or `example.com` and it offers to open it. The browser goes to the search engine itself, so your search never passes through Hearth's server.
- **Favourites:** star a link in edit mode and it goes in the dock at the top. Number keys **1** to **9** open them.
- **Short links:** `start.home/<name>` jumps straight to a link (its short name is in its More options).
- **Status:** every service on the home network is checked every 30 seconds. Green is up, amber slow, red down. Links to the internet get no dot.

## Your look

**Look** (the palette button) changes your own page, unless it's locked:

- **Layout:** the **Command center** (everything on one screen) or **Classic**; links as rows, icons or cards; widgets **among your sections** (packed together into columns, in the order you drag them in Edit mode), or in a rail on the left or right, or off.
- **Theme:** built-in light and dark themes, or the admin's own (Settings → Themes).
- **Background, tiles, shape and space, type:** a picture or colour behind the page, corner shapes, spacing and fonts.
- **Your own CSS**, for anything else.
- **PIN:** your own PIN, or none.

The guest page has a look of its own: with nobody picked and the admin signed in, **Look** changes it.

## Next

- [Widgets](widgets.md) for what goes beside your links.
- [Calendar](calendar.md) to give everyone their own.
- [AI](ai.md) to connect your own AI server.
