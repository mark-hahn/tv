
Vue     = require 'vue'
log     = require('./debug') 'twobtn'

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
  props: ['lftBtnTxt', 'rgtBtnTxt']

  template: render ->
    div '.two-btns',  ->
      div '.btn', vOn: 'click: twoBtnClk', '{{lftBtnTxt}}'
      div '.btn', vOn: 'click: twoBtnClk', '{{rgtBtnTxt}}'

  methods:
    twoBtnClk: (e) -> 
      @$dispatch 'twoBtnClk', e.target.innerText