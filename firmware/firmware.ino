#include <Wire.h>
#include <ArduinoBLE.h>
#include <Adafruit_BMP3XX.h>
#include <SensirionI2cScd4x.h>
#include "MAX30105.h" // SparkFun MAX3010x library
#include "heartRate.h" // SparkFun MAX3010x library for HR calculation
#include "spo2_algorithm.h" // SparkFun MAX3010x library for SpO2 calculation

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

// Pulse and SpO2 tracking (Maxim Algorithm)
uint32_t irBuffer[100]; // infrared LED sensor data
uint32_t redBuffer[100]; // red LED sensor data
int32_t bufferLength = 100; // data length
int32_t spo2; // SPO2 value
int8_t validSPO2; // indicator to show if the SPO2 calculation is valid
int32_t heartRate; // heart rate value
int8_t validHeartRate; // indicator to show if the heart rate calculation is valid
int sampleCount = 0; // current index in the buffer

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
  // SAFETY: Seeed Studio Xiao D14 Hardware Bug Prevention
  // Force D14 to LOW so battery voltage doesn't fry the board while charging
  pinMode(14, OUTPUT);
  digitalWrite(14, LOW);

  Serial.begin(115200);
  delay(2000); // Wait for Serial Monitor to connect
  Wire.begin();
  
  // I2C Scanner
  Serial.println("Scanning I2C bus...");
  int nDevices = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      if (address < 16) Serial.print("0");
      Serial.print(address, HEX);
      Serial.println(" !");
      nDevices++;
    } else if (error == 4) {
      Serial.print("Unknown I2C error at address 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
    }
  }
  if (nDevices == 0) {
    Serial.println("No I2C devices found. Check wiring!");
  } else {
    Serial.println("I2C scan complete.");
  }

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
  BLE.poll();
  BLEDevice central = BLE.central();

  // Always read and process sensors to keep them responsive, even if disconnected.
  processSensors();
  updateHistory();

  if (central) {
    if (central.connected()) {
      // Send data every 200ms (5 times a second) for real-time display
      if (millis() - lastTxMillis > 200) {
        lastTxMillis = millis();
        sendDataOverBLE();
      }
    }
  }
}

void initBMP() {
  // Try default address 0x77 first, then alternate 0x76 (common for third-party breakouts)
  if (!bmp.begin_I2C(0x77) && !bmp.begin_I2C(0x76)) {
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
    // Configure sensor for SpO2 (Red + IR)
    // Default setup is fine, but we ensure both LEDs are powered
    particleSensor.setup(60, 4, 2, 100, 411, 4096); // LED mode 2 (Red + IR), 100Hz, 16-bit ADC
    particleSensor.setPulseAmplitudeRed(0x0A); // Turn Red LED to low to medium
    particleSensor.setPulseAmplitudeIR(0x0A);  // Turn IR LED to low to medium
    particleSensor.setPulseAmplitudeGreen(0);  // Turn off Green LED
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
    particleSensor.check(); // Check the sensor, read up to 3 samples
    
    while (particleSensor.available()) {
      // Read data into buffer
      redBuffer[sampleCount] = particleSensor.getFIFORed();
      irBuffer[sampleCount] = particleSensor.getFIFOIR();
      particleSensor.nextSample(); // We're finished with this sample so move to next sample
      
      sampleCount++;
      
      if (sampleCount >= 100) {
        // Calculate heart rate and SpO2 using Maxim's algorithm
        maxim_heart_rate_and_oxygen_saturation(irBuffer, bufferLength, redBuffer, &spo2, &validSPO2, &heartRate, &validHeartRate);
        
        // Update variables if finger is present and values are valid
        if (irBuffer[99] > 50000) {
          if (validSPO2 == 1 && spo2 > 50 && spo2 <= 100) {
            currentSpO2 = spo2;
          }
          if (validHeartRate == 1 && heartRate > 30 && heartRate < 220) {
            currentHR = heartRate;
          }
        } else {
          // No finger detected
          currentSpO2 = 0;
          currentHR = 0;
        }

        // Shift the last 25 samples to the beginning of the buffer
        // This provides continuous monitoring every 25 samples (0.25 seconds)
        for (byte i = 25; i < 100; i++) {
          redBuffer[i - 25] = redBuffer[i];
          irBuffer[i - 25] = irBuffer[i];
        }
        sampleCount = 75; // continue filling from 75 to 100
      }
    }
    
    // Quick fallback: clear values if finger is removed instantly
    if (sampleCount > 0 && irBuffer[sampleCount - 1] < 50000) {
      currentSpO2 = 0;
      currentHR = 0;
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
