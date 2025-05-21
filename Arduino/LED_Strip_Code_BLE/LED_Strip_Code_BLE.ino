#include <Adafruit_NeoPixel.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// NeoPixel灯带设置
#define LED_PIN        33
#define NUM_LEDS       120
#define CONST_BRIGHTNESS 3 // 常亮模式亮度，降低为原来的60%

// 流动效果参数
const int   WINDOW_SIZE     = 100;
const unsigned long FLOW_INTERVAL = 80;
const uint8_t TAIL_MAX      = 5;

// 呼吸灯效果参数
const unsigned long BREATH_INTERVAL = 30; // 呼吸效果更新间隔(ms)，增加以减慢速度
const unsigned long COLOR_CHANGE_INTERVAL = 8000; // 颜色切换间隔(ms)，增加以给每种颜色更多显示时间

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

String currentMode = "none";
unsigned long lastUpdate = 0;
unsigned long lastColorChange = 0;
int flowOffset = 0;
int breathBrightness = 0;
int breathDirection = 1; // 1 = 变亮, -1 = 变暗
int currentColorIndex = 0; // 当前颜色索引

// BLE UUIDs
#define SERVICE_UUID_STRIP2           "a2b0d839-075d-4439-9775-f7f87437c7c3" // New Unique Service UUID
#define CHARACTERISTIC_UUID_COMMAND_STRIP2 "c7d62238-f8c9-4b07-9cc7-7a52f9600d4d" // New Unique Command Characteristic UUID

BLECharacteristic *pCommandCharacteristic;
bool deviceConnected = false;

// 函数声明
void applyMode(String mode);
void setAll(uint32_t color);
void handleFlow();
void handleBreath();
void startBreathCycle();

// 呼吸灯颜色数组
const uint32_t breathColors[] = {
  strip.Color(0, 100, 100),  // 蓝绿色
  strip.Color(0, 50, 255),   // 浅蓝色
  strip.Color(200, 200, 255), // 冷白色（偏蓝）
  strip.Color(80, 0, 150),   // 紫色
  strip.Color(0, 150, 150)   // 青色
};
const int NUM_BREATH_COLORS = 5; // 更新为新的颜色数量

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Device connected");
      // 连接后自动开始呼吸灯循环
      startBreathCycle();
    }

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Device disconnected");
      // 可以考虑在这里重启广播，以便设备可以重新连接
      BLEDevice::startAdvertising(); 
      Serial.println("Restart advertising");
    }
};

class CommandCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        String value = pCharacteristic->getValue(); // Corrected based on compiler error, getValue() seems to return Arduino String
        if (value.length() > 0) {
            Serial.print("Received Command: ");
            String command = "";
            for (int i = 0; i < value.length(); i++) {
                command += (char)value[i];
                Serial.print(value[i]);
            }
            Serial.println();
            command.trim();
            applyMode(command);
        }
    }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting BLE LED Strip Controller...");

  strip.begin();
  strip.setBrightness(CONST_BRIGHTNESS);
  strip.show(); // Initialize all pixels to 'off'

  // 创建 BLE 设备
  BLEDevice::init("ESP32_Strip_Light_2"); // 设置BLE设备名称

  // 创建 BLE 服务器
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 创建 BLE 服务
  BLEService *pService = pServer->createService(SERVICE_UUID_STRIP2);

  // 创建命令特征
  pCommandCharacteristic = pService->createCharacteristic(
                                         CHARACTERISTIC_UUID_COMMAND_STRIP2,
                                         BLECharacteristic::PROPERTY_WRITE
                                       );
  pCommandCharacteristic->setCallbacks(new CommandCharacteristicCallbacks());
  pCommandCharacteristic->addDescriptor(new BLE2902()); // 允许客户端订阅通知/指示（虽然这里主要是写）


  // 启动服务
  pService->start();

  // 开始广播
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID_STRIP2);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("Characteristic defined! Now you can connect with your phone!");
}

void loop() {
  // 如果是流动模式，则处理流动效果
  if (currentMode.endsWith("_flow")) {
    handleFlow();
  }
  // 如果是呼吸灯模式，则处理呼吸效果
  else if (currentMode == "breath") {
    handleBreath();
  }
  
  // BLE连接和数据处理由回调函数异步处理，loop可以保持简洁
  // 如果需要处理断开连接后的重连等，可以在这里添加逻辑，或者在回调中处理
  if (!deviceConnected) {
      // 可以考虑延时后重新广播，或者由 onDisconnect 回调处理
  }
}

void applyMode(String mode) {
  currentMode = mode;
  Serial.println("[INFO] 切换模式：" + currentMode);

  strip.clear(); // 清除之前的效果
  // strip.show(); // 立即更新灯带，确保清除生效

  flowOffset = 0; // 重置流动偏移
  lastUpdate = millis(); // 重置更新时间
  breathBrightness = 0; // 重置呼吸亮度
  breathDirection = 1; // 重置呼吸方向

  if (mode == "blue") {
    strip.setBrightness(CONST_BRIGHTNESS);
    setAll(strip.Color(0, 0, 255));
  } else if (mode == "red") {
    strip.setBrightness(CONST_BRIGHTNESS);
    setAll(strip.Color(255, 0, 0));
  } else if (mode == "green") {
    strip.setBrightness(CONST_BRIGHTNESS);
    setAll(strip.Color(0, 255, 0));
  } else if (mode == "blue_flow" || mode == "red_flow") {
    strip.setBrightness(100); // 流动时降低亮度，从255降低到100
    handleFlow(); // 立即给一次反馈
  } else if (mode == "breath") {
    // 呼吸灯模式
    strip.setBrightness(breathBrightness);
    setAll(breathColors[currentColorIndex]);
  } else if (mode == "off") {
    setAll(strip.Color(0,0,0)); // 明确关灯
  } else {
    Serial.println("[WARN] 未知模式: " + mode);
    // 可以选择恢复到一个默认状态，例如关灯
    setAll(strip.Color(0,0,0));
  }
}

void setAll(uint32_t color) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

void handleFlow() {
  if (millis() - lastUpdate < FLOW_INTERVAL) return;
  lastUpdate = millis();

  strip.clear();
  for (int i = 0; i < WINDOW_SIZE; i++) {
    int idx = (flowOffset + i) % NUM_LEDS;
    float factor = float(WINDOW_SIZE - i) / WINDOW_SIZE;  
    uint8_t v = uint8_t(factor * (TAIL_MAX - 1)) + 1;

    if (currentMode == "blue_flow") {
      strip.setPixelColor(idx, 0, 0, v);
    } else if (currentMode == "red_flow") { // 确保只处理预期的流动模式
      strip.setPixelColor(idx, v, 0, 0);
    }
  }

  strip.show();
  flowOffset = (flowOffset + 1) % NUM_LEDS;
}

// 处理呼吸灯效果
void handleBreath() {
  // 检查是否需要更新呼吸效果
  if (millis() - lastUpdate < BREATH_INTERVAL) return;
  lastUpdate = millis();
  
  // 更新亮度，增加步长使呼吸效果更明显
  breathBrightness += breathDirection * 1; // 每次变化增加3倍速度
  
  // 检查是否需要改变方向
  if (breathBrightness >= 50) { // 降低呼吸灯最大亮度从255到5
    breathBrightness = 50;
    breathDirection = -1;
  } else if (breathBrightness <= 0) {
    breathBrightness = 0;
    breathDirection = 1;
    
    // 检查是否需要切换颜色
    if (millis() - lastColorChange > COLOR_CHANGE_INTERVAL) {
      lastColorChange = millis();
      currentColorIndex = (currentColorIndex + 1) % NUM_BREATH_COLORS;
      Serial.print("切换颜色到索引: ");
      Serial.println(currentColorIndex);
    }
  }
  
  // 应用新的亮度和颜色
  strip.setBrightness(breathBrightness);
  setAll(breathColors[currentColorIndex]);
}

// 开始呼吸灯循环
void startBreathCycle() {
  currentColorIndex = 0;
  breathBrightness = 0;
  breathDirection = 1;
  lastColorChange = millis();
  applyMode("breath");
  Serial.println("启动呼吸灯循环");
}
