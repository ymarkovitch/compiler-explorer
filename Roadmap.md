# Compiler Explorer Road Map

CE was started in 2012 to serve my needs at [my company](http:/drw.com) in terms of showing how
C++ constructs translated to assembly code. It started out as a `tmux` session with `vi` running in one
pane and `watch gcc -S foo.cc -o -` running in the other. Since those days, it's now a public website
serving the C++, Rust, Go and D communities and performs around 20,000 compilations per day.

This document is an attempt to capture thoughts on the future direction of Compiler Explorer.

## Areas to improve

### Mobile client support

CE's UI doesn't work well with mobile clients. The editor doesn't work well on many mobile clients, and the
layout doesn't lend itself well to small screens.

Ideas for improving mobile support include automatically folding up all the panes into a single tab upon
detection of a mobile client. This would require a bunch of fixes in the 
underlying [UI library](http://golden-layout.com) as this doesn't properly work with mobile and tabs.

Perhaps a read-only simplified view would work better: the main reason one brings up the CE website is to
look at tweeted links rather than author content.

### UI improvements

The UI has a number of things that need improving:

- [X] Multiple editor windows
- [X] Saving and restoring from browser-local storage
- [ ] Handling the loss of data if one has a work-in-progress CE window open and then clicks another CE link.

### Diff view

A frequently requested feature that arrived with the inclusion of the [Monaco](https://microsoft.github.io/monaco-editor/) editor.

### Execution support

Another big ticket item is to allow executing of the user's code. This is fraught with security issues, and
brings up a number of UI and API considerations. Compiling code every time to execute with different params
seems wasteful, so caching seems good; but in a multi-instance setup a shared cache woudl be needed. Perhaps
a backend system that caches the executables (and makes them downloadable; at least for some compilers where
license allows), and stores the binaries in ephemeral, shared storage. This same backend system could also 
be used to store code, and could be part of a whole new way of sending and sharing code (if made permanent
storage).

### Support more compilers

Most of the open tickets are to do with adding new compilers, or fixing issues with existing compilers.
Continuing to add more compilers and make it easier for others to submit PRs to add new compilers is
very important.

## Tensions

There's an inherent tension between the standalone, run-it-yourself version of CE and the scalable, AWS-backed
CE instance. Care must be taken to keep the standalone version usable, not least as the majority of CE's
development is done on a laptop during a commute (with little or no internet access).

## Priorities

Above all, the priority is to keep the main CE site up, stable and dependable. After that, features are
added honestly in the order that is most useful and interesting to the primary developer (Matt Godbolt).

## Non-goals
CE will remain ad-free, open-source and non-commercial. There's no plans at all to add "freemium" content.

## 2017 goals

With all this in mind, the tentative goals for 2017 are:

- [X] Move to the Monaco editor
   - [X] Implement diff view
- [ ] Come up with a decent secure solution for code execution
- [ ] Design an API that can handle remote code execution and download needs
- [ ] Implement remote execution UIs

These goals will be refined as time ticks on.
