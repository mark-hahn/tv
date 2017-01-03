
#include <WiFiManagerXy.h>       // https://github.com/tzapu/WiFiManagerXy
#include <IRremoteESP8266.h>     // https://github.com/markszabo/IRremoteESP8266

ESP8266WebServer server(80);
IRsend irsend(4);

void ledOn()  { digitalWrite(2, 0); }
void ledOff() { digitalWrite(2, 1); }

#define IRt unsigned int
IRt power[29]  = {40000,3,1,96, 24,48,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt pwrOff[29] = {40000,3,1,96, 24,48,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt pwrOn[29]  = {40000,3,1,96, 24,24,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt volUp[29]  = {40000,3,1,96, 24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt volDn[29]  = {40000,3,1,96, 24,48,24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt mute[29]   = {40000,3,1,96, 24,24,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt hdmi1[29]  = {40000,3,1,96, 24,24,24,24,24,24,24,48,24,24,24,24,24,48,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt hdmi2[29]  = {40000,3,1,96, 24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,48,24,24,
                                24,24,24,24,24,24,1035};
IRt hdmi3[35]  = {40000,3,1,96, 24,24,24,24,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24,24,48,24,48,
                                24,24,24,24,24,24,1035};
IRt hdmi4[35]  = {40000,3,1,96, 24,48,24,24,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24,24,48,24,48,
                                24,24,24,24,24,24,1035};

void sendCode(int code) {
  Serial.print("sending ir: "); Serial.println(code);
  switch (code) {
    case 0: irsend.sendGC(power, 29); break;
    case 1: irsend.sendGC(pwrOff,29); break;
    case 2: irsend.sendGC(pwrOn, 29); break;
    case 3: irsend.sendGC(volUp, 29); break;
    case 4: irsend.sendGC(volDn, 29); break;
    case 5: irsend.sendGC(mute,  29); break;
    case 6: irsend.sendGC(hdmi1, 29); break;
    case 7: irsend.sendGC(hdmi2, 29); break;
    case 8: irsend.sendGC(hdmi3, 35); break;
    case 9: irsend.sendGC(hdmi4, 35); break;
  }
}

void setup()
{
  irsend.begin();
  Serial.begin(115200);

///////////////// INIT WIFI  //////////////
  WiFiManagerXy WiFiManagerXy;
  // WiFiManagerXy.resetSettings();
  String ssid = WiFiManagerXy.autoConnect();
  Serial.println(String("eridien XY connected to ") + ssid);

  // Wait for connection
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
  }

///////////////  HTTP SERVER  ///////////////
  server.onNotFound([](){
    server.send(404, "text/plain", "eridien XY, 404: File Not Found");
  });
  server.on("/", HTTP_GET, [](){
    sendCode(server.arg("code").toInt());
    server.send(200, "text/plain", "OK");
  });
  server.begin();
  ledOff();
  Serial.println("HTTP server started");
}

void loop() {
  server.handleClient();
}
