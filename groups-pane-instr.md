
# managing unilog groups
- i want to upgrade the unilog log viewer to be able to manage groups

## currently
- collections of unilog sites are specified by assigning sites to groups
  - example groups (collections):
    - sites in one function
    - sites in a processing flow like a button click to a final action
    - all sites where a var is modified
- the log_events table is joined to the log_groups table by site_groups table
- log_groups table row has a description of the group in a field
  - group descriptions are often just considered group names
- the groups for an event's site are shown in a groups column in the event row 
  - the group cell format is a string of all groups for that site concatenated with commas

## add a group overlay pane
- i want a "groups" pane with ui controls to manage groups
  - you can design the ui layout based on sections below
- the groups pane should partially overlay the list.vue side of the window
  - the list.vue should not be changed, it should just be overlayed
  - the pane should be only as large as needed
  - align the right side of the pane to the right side of list.vue
  - the pane should should be centered vertically in the window
- add a button `Groups` to the right of the actions selector dropdown in the log pane
  - it should show/hide the groups pane
  - show the groups pane only when log pane is open
  - the groups pane should be hidden when log pane is opened or closed
- use v-show for the pane so its state is preserved until reload

## the main groups list
- a multiple selection list should be on the left side of the group pane
  - it should use the built-in html element
- it should be the full height of the pane except for height of a title `Groups`
- it should be an alphabetical list of all groups in log_groups table
- each group listed should use the description field in log_groups
  - we consider the description field to be the group name everywhere
- we will call the selected items the selected groups

## filtering by group
- currently the group column header text box filters by matching the group string in the cell
  - we will not replace that string filter, the new filtering is in addition to that
- we should filter the event rows by one or more selected groups
- use a checkbox called `Filter`
  - if there are no selected groups then gray out the checkbox and disable it
  - when filter is checked then filter out all event rows that don't have their site joined to one of the selected groups
    - this is in addition to all other filtering

## adding a new group
- use a text input box to type in a new group name
- put an `Add Group` button next to it
  - when there is no name in the input box then gray out the add button and disable it
  - when there is a name in the input box and add is clicked:
    - if it is already the name of an existing group then do nothing
    - add group to the log_groups table with the group name as the description
    - add a join to the site_groups table for each selected site in the event rows
      - so the new group will be assigned to all selected sites

## assigning groups to sites
- add a button called `Assign`
- it should add all selected groups to all selected sites in the event rows
  - a join for every combination of selected group and selected site should be created

## removing groups from sites
- add a button called `Remove`
- it should remove the selected groups from the selected sites
  - it should delete the join for every combination of selected group and selected site

## deleting existing groups
- add a new button called `Delete Selected` under the add button
  - if there is no selected group then gray out the Delete button and disable it
  - when there is a selected group and delete button is clicked then:
    - show a confirmation dialog that shows the warning and these stats
      - the number of groups that will be deleted
      - the number of sites that will have a group removed
      - should look like `Is it ok to remove X groups from Y sites?`
    - if confirmed then delete all selected groups from log_groups and site_groups tables 

## notes
- make a plan and write it to ./groups-pane-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
