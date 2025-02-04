# Dumb Dumb Code Checker

Slow and simple but somewhat working code analysis agent that can navigate through code base.

## Quick start
### Installation
```sh
git clone https://github.com/knilink/dumb-dumb-code-checker.git
cd dumb-dumb-code-checker
npm install
```

Then edit `src/config.ts` for preferred models and options.

### Run
Here using this project as an example. For different project, specify a different `--workspace`.
```sh
# please let me know immedediately if you come across with a model smart enough to notice this project is actually itself
OLLAMA_HOST='http://localhost:11434' npm run start -- --workspace . --query "what does this stupid project do?" --max-iterations 16 --init-ctx=none

# lol
npm run start -- -w . -q 'find evidences in this project to prove YOU ARE "dumb-dumb-code-checker"'

# this one is interesting as "model" could mean data model, llm model or else
npm run start -- -w . -q "how do i use a different model?" --init-ctx=none

npm run start -- -w . -q "getting connect ECONNREFUSED 127.0.0.1:11434"

# should know it's unrelevant and ask for clarification straight away
npm start -- -w . -q "is calling kakapo dumb offensive?" --init-ctx=relevant-files
```

## Suggested models
This is base my experience testing with open source models.
### Thinking
Chain of thought model is highly recommended.
- `qwq:32b-preview-q4_K_M`: creative but heavily hallucinating, suggested to use with a decent summarizer to filter out noises, recommended temperature 0.7 ~ 1.2
- `deepseek-r1:32b-qwen-distill-q4_K_M`: concise and stable but less creative, being path dependence and not able to think out of box. `qwq` is preferred over this model

### Summarizing
Models with decent reasoning capabilities will be more likely to capture key information and filter out noise.
- `mistral-large:123b-instruct-2407-q2_K`: top open source reasoning model
- `qwen2.5:32b-instruct-q4_K_M`: could be sufficient for simple, closed ended query

### Tool Calling
Reasoning is not mandatory but a good reasoning model will be more likely to capture the correct information.
- `qwen2.5:32b-instruct-q4_K_M`: sufficient, but rarely it will simply copy/pasting content although the arguments make no sense
- `mistral-large:123b-instruct-2407-q2_K`: tool calling structure may deformed due to heavily quant, and it too good at reasoning thus sometime it may refuse to pick any tool if the query is too vague.

## Tips
Although, technically, any query would work, however, dumb dumb is dumb and doesn't known when to stop investigating.
Thus, a clear, simple, single purpose, closed ended question and explicitly stating the end condition could help ending investigation earlier.

- ✗ "i'm conducting an security audit and wondering where `foo` in file `bar` is from": security audit is not directly related to the query and dumb dumb will eventually try to access the source code of node.js looking for vulnerabilities
- ✓ "locate the source of 'foo' in file 'bar'": simple and explicitly state it's a navigation task

Also try a higher temperature if observing copy/pasting entire file or other content when summarizing.
