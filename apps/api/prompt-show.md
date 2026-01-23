- forget all previous ai context. start a new conversation.
- follow these instructions exactly. check your output against your requirements.
- Look up the show using these identifiers in priority order and actually use them in your search queries: first the IMDb title id <imdb id> (search as site:imdb.com/title/<imdb id>); if that fails, use the TVDB series id <tvdb id>; only if all ids fail, search by show name "<show name>".
- do not say anything about how the show was found or how you looked for it. don't show header like "Here’s the requested information" or like "The TV show with TVDB ID 408436 is Bad Monkey" or "Here’s the requested information:" or like "The show with IMDb ID tt33270420"

- this is extremly important: do not make show names bold after the first occurance.

- don't show section titles
- do not mention tvdb id like "TVDb ID 408436" or "The show with TVDb ID 78461"
- show in paragraph format, not outline

# show these sections as paragraphs
- summary
  - two sentence summary
    - include show name
    - make first instance of show name bold 

- longer description that includes
  - beginning and ending years on air
    - if beginning and ending are same year then just say "aired on <year>"
  - major actors
  - if sequal then name original show(s)
    - don't mention sequal if there is none
  - genre

- who created it
  - other shows they have created in order of popularity

- imdb rating and general popularity
  - don't shoe IMDb rating "out of". show it as "7.7" not "7.7/10"

- whether the show is continuing with future episodes

Emphasize actor names by wrapping each actor name in italics (Markdown *Name*) every time you mention them; do not bold actor names and do not italicize character names or show titles.”

