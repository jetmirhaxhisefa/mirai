# Project facts checklist

For the verifier. Each line is a yes / no question about one `.mirai/context/project-<service>.md`.
The lint has already checked that each path exists and that each command's package script is in
its manifest. These need judgement.

- Do the commands work as written, from the repo's top folder, including how to run one test file?
- Are the versions the ones the manifests and images set today?
- Does the layout name the places an agent needs first, and say what's misleading (a folder that
  looks unused but isn't)?
- Do the test levels match the config's levels for this service?
- Does it point to the service's own instructions instead of copying them?
- Is it short: facts an agent can't read quickly from the code, not a copy of a manifest or a tree?
- Is anything left from the template: a guidance line, a placeholder, the sample id?
