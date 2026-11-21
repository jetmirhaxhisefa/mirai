# Critical journeys checklist

For the verifier, and for you before you approve. Each line is a yes / no question about
`.mirai/context/journeys.md`. The lint has already checked the shape: each journey has a J-n ID
with no gap, steps, a "Why critical:" line with its source, and an E2E test that exists or "none
yet". These need judgement.

- Does each journey lose users or money when it breaks? A flow that's only nice to have isn't
  critical: drop it.
- Is a flow the business depends on missing, such as signing in, paying or the product's main
  task?
- Are there few of them, five or fewer for most products, most important first?
- Is each step one action a person takes, on a screen the feature map names?
- Does each "Why critical:" line say who is stopped, or what is lost, not just "it's important"?
- Does the E2E test named really walk through this journey's steps?
- Is anything left from the template: a guidance line, a placeholder, the sample id?
