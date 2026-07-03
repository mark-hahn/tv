
# response to groups-pane-plan.md

## Ambiguities, contradictions, and notes
1. use Teleport 
2. use your suggestion to disable buttons
3. do nothing and flash a notice
4. use `manual`
5. noted (see one-time operation below that cleans up descriptions)
6. do auto-refresh
7. Acceptable; noted
8. noted

use all Suggestions

## new instructions
- as a one-time operation change descriptions of groups with a null or duplicate description to `Group <group id>`
- add a button `Orphans`
  - this should select all groups in groups list that are not assigned to a site that is used in an event
    - find the set of all sites that are not present in any event record
      - call this set the orphaned sites
    - find the set of all joins to the orphaned sites
      - call this set the orphaned joins
    - select groups that are only joined to orpaned joins
- don't filter events by groups pane filter when groups pane is closed
- in groups list if the group has a non-blank group_type then append that to the end of the group name with parens
- add a type input box with a button:
  - Set-type <input v-model="setGroupType"> + `Set Type` button
  - when clicked replace the group_type field in all selected groups with the input value
  - button should be disabled if no group is selected or input box is empty
- add a button `Clear Type`
  - when clicked set group_type of selected groups to empty string
  - button should be disabled if no group is selected
- add a name input box with a button:
  - Set-name <input v-model="setGroupName"> + `Set Name` button
  - when clicked replace the description field of the one selected group with the input value
  - button should be disabled if no group is selected or if more than 1 group is selected or group with that name already exists or input box is empty

## notes
- if there are any serious ambiguities, contradictions, or impossibilities then stop and let me know
  
implement plan now
