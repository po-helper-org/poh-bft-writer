# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: first-request.spec.ts >> вход без кода → обращение в композере → чат начался
- Location: e2e/first-request.spec.ts:17:1

# Error details

```
Test timeout of 60000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic:
    - generic:
      - generic:
        - generic:
          - banner [ref=e6]:
            - button "Open right sidebar" [ref=e9] [cursor=pointer]
          - generic:
            - generic:
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - generic [ref=e12]:
                        - generic:
                          - generic:
                            - generic:
                              - generic [ref=e17]: Into the Unknown
                              - generic [ref=e18]: Preview
                      - generic [ref=e19]:
                        - button "Choose workspace" [ref=e20] [cursor=pointer]:
                          - generic: Customer-requests
                        - button "Standard mode" [ref=e29] [cursor=pointer]
                      - generic [ref=e38]:
                        - generic:
                          - textbox "Describe what you want to build, / commands, @ files or sessions" [active] [ref=e39]
                          - generic [ref=e40]:
                            - generic:
                              - button "Add files or run commands" [ref=e41] [cursor=pointer]
                              - 'button "Access mode, current: Workspace Write" [ref=e45] [cursor=pointer]'
                            - generic [ref=e54]:
                              - button "Select model, current DeepSeek-V41-Flash, reasoning effort High" [ref=e58] [cursor=pointer]
                              - button "Send message" [disabled] [ref=e64]
```