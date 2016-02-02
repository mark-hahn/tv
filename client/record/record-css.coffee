(document.head.appendChild document.createElement('style')).textContent = """
  .net-btns-outer {
    width: 75%;
    height: 32rem;
    background-color: white;
    border-radius: 1rem;
    margin-top: 0.5rem;
    overflow: auto;
  }
  .net-btns-inner {
    width: 90%;
    border: 1px sold gray;
    margin-left:5%;
  }
  .net-btn {
    padding:0.3rem;
  }
  .chan-img {
    padding:0.2rem;
    display:none;
  }
  .record-cbl {
    display: inline-block;
    width: 50%;
    color: red;
    font-size: 1.4rem;
    padding: 1rem 0 0 2rem;
  }
  .rec-input {
    width: 40%;
    font-size: 1.2rem;
  }
  .rec-input {
    width: 50%;
    font-size: 1.0rem;
    position: relative;
    right: 1rem;
    top: -.15rem;
  }
  .rec-list {
    overflow: auto;
    width:100%;
    height:50%;
  }
  .recording {
    background-color: white;
    border: .1rem solid gray;
    margin: 1rem;
    padding: 0.55rem 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .chan-div {
    display: inline-block;
    width: 20%;
    position: relative;
    height: 1.7rem;
  }
  .chan-num {
    position: absolute;
    top: 0;
    left: 1.2rem;
    display: inline-block;
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
  .chan-img.chan-pad {
    position:relative;
    left:1rem;
  }
  .chan-img.fox-pad {
    position:relative;
    left: 0.5rem;
    top: -.2rem;
  }
  .recording > .rec-time {
    font-family: monospace;
    font-size: 0.95rem;
    display: inline-block;
    width: 80%;
    position: relative;
    left: 0.35rem;
    top: -0.7rem;
  }
  .popup-show {
    font-size: 1.3rem;
    width: 100%;
    border-radius: 0.5rem;
    border: 1px solid gray;
    background-color: white;
  }
  .popup-hdr {
    font-size: 1.4rem;
    color: red;
    margin: 0.7rem 1rem 0 1rem;
    display: inline-block;
  }
  .now-btn {
    font-size: 1.05rem;
    border-radius: 0.5rem;
    margin-left: 23%;
  }
  .rec-btn {
    font-size: 1.3rem;
    border-radius: 0.5rem;
    margin: 0.5rem 4.3rem 1.5rem 1rem;
  }
  .picker-input-div {
    display:none;
    font-size:1.3rem;
  }
  .date-picker {
    margin-top: 1rem;
  }
  .picker-input-lbl {
    margin: 1rem 0.5rem 0.5rem 1rem;
  }
  .time-sel-lbl {
    display: inline-block;
    font-size:1.3rem;
    margin: 1rem 0.5rem 0.5rem 1rem;
  }
  .time-sel {
    margin-left: 0.5rem;
    font-size: 1.1rem;
  }
"""
