// event-bus.js
import mitt from 'mitt';
const  evtBus = mitt();
export const windowLabel = Math.random();
export default evtBus;
