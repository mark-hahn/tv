
# show a unilog site in a vscode editor
- in the log pane add an action `Editor` at the bottom of the list in the actions dropdown 
- when `Editor` is selected: 
  - if there are no events selected show a toast saying `No event selected` 
  - if there is more than one events selected show a toast saying `Only one event should be selected`
  - if one event selected then open a editor in vscode
    - it should contain the log_site src_file 
    - it should be scrolled to the src_line
    - the src_line should be selected
    - use the editor that currently has the workspace /root/apps/tv open
      - use the vite connection to communicate with vscode
    - let me know if an extension or wsl script is needed for vite to find and control vscode      
- make a plan and write it to ./vscode-open-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions