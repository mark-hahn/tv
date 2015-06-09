
Vue     = require 'vue'
log     = require('debug') 'tv:twobtn'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .two-btns {
    padding-top: 0.6rem;
    width: 100%;
  }
  .two-btns .btn {
    width: 50%;
  }
"""

Vue.component 'two-btns',
  paramAttributes: ['lft-btn-txt', 'rgt-btn-txt']

  template: render ->
    div '.two-btns',  ->
      div '.btn', vOn: 'click: twoBtnClk', vText: 'lftBtnTxt'
      div '.btn', vOn: 'click: twoBtnClk', vText: 'rgtBtnTxt'
    
  methods:
    twoBtnClk: ->