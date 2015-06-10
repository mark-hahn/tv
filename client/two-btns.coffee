
Vue     = require 'vue'
log     = require('debug') 'tv:twobtn'

{render, tag, div} = require 'teacup'

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
  props: ['lft-btn-txt', 'rgt-btn-txt', 'two-btn-clk']

  template: render ->
    div '.two-btns',  ->
      div '.btn', vOn: 'click: twoBtnClk', vText: 'lftBtnTxt'
      div '.btn', vOn: 'click: twoBtnClk', vText: 'rgtBtnTxt'
