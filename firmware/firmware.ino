#include <Wire.h>
#include <ArduinoBLE.h>
#include <Adafruit_BMP3XX.h>
#include <SensirionI2cScd4x.h>
#include "MAX30105.h" // SparkFun MAX3010x library
#include "heartRate.h" // SparkFun MAX3010x library for HR calculation

// ==========================================
// SENSOR INSTANCES
// ==========================================
Adafruit_BMP3XX bmp;
SensirionI2cScd4x scd4x;
MAX30105 particleSensor;

// ==========================================
// BLUETOOTH (Nordic UART Service)
// ==========================================
BLEService uartService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
BLEStringCharacteristic txChar("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", BLERead | BLENotify, 256); // TX (Device -> App)
BLEStringCharacteristic rxChar("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", BLEWrite | BLEWriteWithoutResponse, 256); // RX (App -> Device)

// ==========================================
// HISTORY & TIMING
// ==========================================
const int HISTORY_SIZE = 180; // 3 hours at 1 reading per minute
float pressureHistory[HISTORY_SIZE];
int historyIndex = 0;
bool historyFilled = false;
unsigned long lastMinuteMillis = 0;
unsigned long lastTxMillis = 0;

// Pulse tracking
const byte RATE_SIZE = 4; // Increase for more averaging. 4 is good.
byte rates[RATE_SIZE]; 
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute;
int beatAvg;

// Variables
float currentPressure = 0.0;
float deltaP3h = 0.0;
uint16_t co2 = 0;
int currentSpO2 = 0;
int currentHR = 0;

// Sensor Status Flags
bool bmpOk = false;
bool scdOk = false;
bool maxOk = false;

void setup() {
  Serial.begin(115200);
  Wire.begin();
  
  // Set ADC resolution for battery voltage
  analogReadResolution(12);

  // Initialize Sensors
  initBMP();
  initSCD41();
  initMAX30105();

  // Initialize BLE
  if (!BLE.begin()) {
    Serial.println("Starting BLE failed!");
    while (1);
  }

  BLE.setLocalName("nRF52_Sensors");
  BLE.setAdvertisedService(uartService);
  uartService.addCharacteristic(txChar);
  uartService.addCharacteristic(rxChar);
  BLE.addService(uartService);
  BLE.advertise();
  
  Serial.println("BLE Peripheral active, waiting for connections...");
  
  // Pre-fill history with 0s
  for(int i=0; i<HISTORY_SIZE; i++){
    pressureHistory[i] = 0.0;
  }
}

void loop() {
  BLEDevice central = BLE.central();

  // Always read and process sensors to keep them responsive, even if disconnected.
  processSensors();
  updateHistory();

  if (central) {
    if (central.connected()) {
      // Send data every 1 second
      if (millis() - lastTxMillis > 1000) {
        lastTxMillis = millis();
        sendDataOverBLE();
      }
    }
  }
}

void initBMP() {
  if (!bmp.begin_I2C()) {
    Serial.println("Could not find a valid BMP3 sensor, check wiring!");
    bmpOk = false;
  } else {
    bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
    bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
    bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
    bmp.setOutputDataRate(BMP3_ODR_50_HZ);
    bmpOk = true;
  }
}

void initSCD41() {
  scd4x.begin(Wire, 0x62);
  // stop potentially previously started measurement
  uint16_t err = scd4x.stopPeriodicMeasurement();
  if (err == 0) {
    scd4x.startPeriodicMeasurement();
    scdOk = true;
  } else {
    Serial.println("Could not initialize SCD41!");
    scdOk = false;
  }
}

void initMAX30105() {
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30105 was not found. Please check wiring/power. ");
    maxOk = false;
  } else {
    particleSensor.setup(); 
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0); 
    maxOk = true;
  }
}

void processSensors() {
  // BMP388
  if (bmpOk && bmp.performReading()) {
    currentPressure = bmp.pressure / 100.0; // convert to hPa
  }

  // SCD41
  if (scdOk) {
    bool isDataReady = false;
    scd4x.getDataReadyStatus(isDataReady);
    if (isDataReady) {
      float temp, hum;
      scd4x.readMeasurement(co2, temp, hum);
    }
  }

  // MAX30105
  if (maxOk) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();
    
    if (checkForBeat(irValue) == true) {
      long delta = millis() - lastBeat;
      lastBeat = millis();
      beatsPerMinute = 60 / (delta / 1000.0);
      if (beatsPerMinute < 255 && beatsPerMinute > 20) {
        rates[rateSpot++] = (byte)beatsPerMinute;
        rateSpot %= RATE_SIZE;
        beatAvg = 0;
        for (byte x = 0 ; x < RATE_SIZE ; x++) beatAvg += rates[x];
        beatAvg /= RATE_SIZE;
      }
    }

    if (irValue > 50000) { 
      currentHR = beatAvg;
      currentSpO2 = 98; // Placeholder for when finger is present
    } else {
      currentHR = 0;
      currentSpO2 = 0;
    }
  }
}

void updateHistory() {
  if (millis() - lastMinuteMillis >= 60000) { // 1 minute
    lastMinuteMillis = millis();
    
    if (currentPressure > 100) { // valid reading
      pressureHistory[historyIndex] = currentPressure;
      
      int oldestIndex = (historyIndex + 1) % HISTORY_SIZE;
      
      if (!historyFilled && historyIndex == HISTORY_SIZE - 1) {
        historyFilled = true;
      }
      
      if (historyFilled) {
        deltaP3h = currentPressure - pressureHistory[oldestIndex];
      } else {
        deltaP3h = currentPressure - pressureHistory[0]; // partial delta
      }
      
      historyIndex = (historyIndex + 1) % HISTORY_SIZE;
    }
  }
}

int getBatteryPercentage() {
  // Read battery voltage on PIN_VBAT for XIAO nRF52840
  #ifdef PIN_VBAT
    int raw = analogRead(PIN_VBAT);
    float voltage = raw * (3.3 / 4095.0) * 2.0; 
    
    // Simple linear approx for LiPo (3.2V - 4.2V)
    int pct = (voltage - 3.2) / (4.2 - 3.2) * 100;
    if (pct > 100) pct = 100;
    if (pct < 0) pct = 0;
    return pct;
  #else
    return 100; // Mock if not defined
  #endif
}

void sendDataOverBLE() {
  int batt = getBatteryPercentage();
  
  int errMask = 0;
  if (!bmpOk) errMask |= 1;
  if (!scdOk) errMask |= 2;
  if (!maxOk) errMask |= 4;

  // Construct JSON string
  String json = "{";
  json += "\"hr\":" + String(currentHR) + ",";
  json += "\"spo2\":" + String(currentSpO2) + ",";
  json += "\"p\":" + String(currentPressure, 2) + ",";
  json += "\"co2\":" + String(co2) + ",";
  json += "\"dp\":" + String(deltaP3h, 2) + ",";
  json += "\"b\":" + String(batt) + ",";
  json += "\"e\":" + String(errMask);
  json += "}";

  txChar.writeValue(json);
  Serial.println("Sent: " + json);
}
