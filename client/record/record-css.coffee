(document.head.appendChild document.createElement('style')).textContent = """
  .rec-left {
    width: 75%;
    height: 31rem;
    background-color: white;
    border-radius: 1rem;
    margin: 0.5rem 0 1.5rem 0;
    overflow: auto;
    float:left;
  }
  .net-btns-inner {
    width: 90%;
    border: 1px sold gray;
    margin-left:5%;
  }
  .net-btn {
    padding:0.3rem;
  }
  .net-btn.chan-sel {
    background-color: #ddd;
    border-radius: 0.5rem;
  }
  .rec-chan-img-div {
    height: 2rem;
    width:4rem;
    display:inline-block;
    position:relative;
    top:0.4rem;
  }
  .rec-empty-img {
    position:absolute;
    height: 3rem;
    width:4rem;
  }
  .rec-chan-img {
    position:absolute;
    height: 3rem;
    width:4rem;
    display:none;
  }
  .rec-chan-txt {
    height: 3rem;
    margin-left:1rem;
    display:inline-block;
    position:relative;
    top:0.35rem;
  }
  .chan-txt {
    font-size:1.3rem;
  }
  .rec-right {
    width: 25%;
    float: right;
    margin-top: 0.5rem;
    height: 31rem;
  }
  .right-sel-btn {
    background: pink;
  }
  .live-btn {
    cursor:pointer;
    font-size: 1.2rem;
    margin: 1rem;
    text-align: center;
    border: 1px solid gray;
    border-radius: 0.3rem;
    padding: 0 1rem 0 1rem;
  }
  .rec-bot {
    clear:both;
  }
"""
