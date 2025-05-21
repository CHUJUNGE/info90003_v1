#include <Wire.h>               // MPU6050 使用 I2C，需要 Wire 库
#include <Adafruit_MPU6050.h>   // Adafruit MPU6050 库
#include <Adafruit_Sensor.h>    // Adafruit 传感器通用库
#include <Adafruit_NeoPixel.h>  // Adafruit NeoPixel 灯带库

// ====== 新增 BLE 相关库 ======
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLEDescriptor.h> // For BLE2902 descriptor
#include <ArduinoJson.h>        // JSON处理库 (如果BLE命令参数复杂，可能仍需保留，简单命令可不用)


// -------- 移除/注释掉 WiFi 和 WebSocket 相关库 --------
// #include <WiFi.h>               // ESP32 WiFi库
// #include <AsyncTCP.h>           // 异步TCP库
// #include <ESPAsyncWebServer.h>  // 异步Web服务器库
// #include <ArduinoJson.h>        // JSON处理库 - 已在BLE部分保留，根据需要决定
// #include <ESPmDNS.h>            // mDNS库，用于本地域名
// ----------------------------------------------------

// ====== 引脚定义 ======
#define BUTTON_PIN 15  // 按钮引脚
#define MOTOR_PIN 33   // 马达引脚

#define LED_PIN 32     // LED 灯带数据引脚
#define NUMPIXELS 16   // LED 灯珠数量
#define TAIL_LENGTH 5  // LED 动画尾巴长度 (进度条长度)

// ====== 系统常量和计时器 ======
#define UART_BAUD 115200

const long statusInterval = 1000;  // 状态输出间隔 (ms)

unsigned long lastMpuTime = 0;     // 上次读取MPU数据的时间
unsigned long lastStatusTime = 0;  // 上次输出状态信息的时间

// ====== 按钮状态和消抖 ======
bool lastButtonState = HIGH;  // 假设按钮使用上拉电阻，按下为LOW
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;  // 消抖延迟 (ms)

// ====== 马达控制变量 ======
bool motorActive = false;             // 马达是否正在震动
int vibrationCount = 0;               // 震动次数计数
int totalVibrations = 1;              // 总共需要震动的次数
unsigned long lastVibrationTime = 0;  // 上次马达状态改变时间
const long vibrationDuration = 200;   // 每次震动 ON 持续时间 (ms)
const long vibrationInterval = 300;   // 每次震动 OFF 持续时间 (ms)

// ====== LED 控制变量和模式定义 ======
// 模式定义：
// 0: 关闭
// 1: 红色常亮
// 2: 蓝色常亮
// 3: 绿色常亮
// 4: 红色带尾巴转圈
// 5: 蓝色带尾巴转圈
int ledMode = 0;  // 初始默认模式为关闭

// LED 控制变量

bool shouldAnimate = false;           // 是否应该执行动画更新
int currentLed = 0;                   // 当前动画的起始 LED 序号
unsigned long previousLedMillis = 0;  // 上次动画步进的时间
const long animationInterval = 80;    // 动画步进间隔 (ms)

// -------- 移除/注释掉 WiFi和WebSocket配置 --------
// const char *ssid = "fish";      // WiFi名称
// const char *password = "88888888";        // WiFi密码
// const int webSocketPort = 81;             // WebSocket端口
// const char *mdnsHostName = "crimescene";  // mDNS主机名

// AsyncWebServer server(80);  // Web服务器实例，端口80
// AsyncWebSocket ws("/ws");   // WebSocket实例，路径/ws

// int connectedClients = 0;                         // 已连接客户端计数
// bool automaticDataSending = false;                // 是否自动发送数据，默认关闭
// unsigned long lastSensorDataTime = 0;             // 上次发送传感器数据的时间
// const unsigned long SENSOR_DATA_INTERVAL = 1000;  // 传感器数据发送间隔(ms)
// ----------------------------------------------------

// ====== 新增 BLE 配置和变量 ======
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b" 
#define CHARACTERISTIC_UUID_COMMAND "beb5483e-36e1-4688-b7f5-ea07361b26a8" // 可写，用于接收命令
// 后续会添加用于发送MPU数据和状态的特征值UUID

// MPU6050 Data Characteristic
#define MPU_CHARACTERISTIC_UUID "1c95d5e6-2080-4808-a504-18763a9866ea" // 新的UUID给MPU6050数据
BLECharacteristic *pMpuCharacteristic = nullptr;

unsigned long lastMpuNotifyTime = 0;
const unsigned long mpuNotifyInterval = 200; // 发送MPU数据的间隔 (毫秒)

BLECharacteristic *pCharacteristicCommand; // 全局指针，方便访问
bool bleDeviceConnected = false;
bool oldBleDeviceConnected = false;
// ------------------------------------

// ====== 硬件对象实例 ======
Adafruit_MPU6050 mpu;                                               // 创建MPU6050实例
Adafruit_NeoPixel strip(NUMPIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);  // 创建NeoPixel实例


// ====== 函数声明 ======
// -------- 移除/注释掉 网络相关函数声明 --------
// void connectToWiFi();
// void setupAccessPoint();
// void setupRoutes();
// void initWebSocket();
// void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
//                       AwsEventType type, void *arg, uint8_t *data, size_t len);
// void handleWebSocketMessage(AsyncWebSocketClient *client, uint8_t *data, size_t len);
// void sendMPUData(AsyncWebSocketClient *client); // 将被替换为BLE版本
// void sendDeviceStatus(AsyncWebSocketClient *client); // 将被替换为BLE版本
// void broadcastActionCompleted(int id); // 将被替换或移除
// void sendButtonState(AsyncWebSocketClient *client); // 将被替换为BLE版本
// void broadcastMPUData(); // 将被替换为BLE版本
// ----------------------------------------------------

// 保留原有功能的函数声明
void initMPU();
void printStatus();
void readMPU6050Data(); // Update MPU data handling to use BLE
void checkButton(unsigned long currentTime);
void startMotorVibration(unsigned long currentTime, int type = 0);
void handleMotor(unsigned long currentTime);
void setLedMode(int mode);
void handleLED(unsigned long currentTime);
void constantColor(uint32_t c);


// ====== 新增 BLE 回调类 ======
class MyBLEServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      bleDeviceConnected = true;
      oldBleDeviceConnected = true; // 确保首次连接时能触发下面的逻辑
      Serial.println("BLE Device connected");
    }

    void onDisconnect(BLEServer* pServer) {
      bleDeviceConnected = false;
      Serial.println("BLE Device disconnected");
      // 为了在断开连接后能被重新发现，需要重新开始广播
      BLEDevice::startAdvertising(); 
      Serial.println("Restarting BLE advertising");
    }
};

class MyCommandCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        String receivedValue = pCharacteristic->getValue(); // Get as Arduino String

        if (receivedValue.length() > 0) {
            Serial.print("BLE Received Command: ");
            Serial.println(receivedValue); // Print Arduino String directly

            // 解析命令 (示例：L[mode_number], e.g., "L1" for mode 1, "L0" for mode 0)
            if (receivedValue.startsWith("L") && receivedValue.length() > 1) {
                String modeArg = receivedValue.substring(1);
                int requestedMode = modeArg.toInt();
                Serial.print("Requesting LED Mode: ");
                Serial.println(requestedMode);
                setLedMode(requestedMode); 
            } 
            else if (receivedValue.startsWith("M")) {
                // 处理马达震动命令
                // 先打印原始接收到的值（用于调试）
                Serial.print("Raw motor command: [");
                for (int i = 0; i < receivedValue.length(); i++) {
                    Serial.print((int)receivedValue[i], HEX);
                    Serial.print(" ");
                }
                Serial.println("]");
                
                // 去除首尾空白字符
                receivedValue.trim();
                
                // 再次打印处理后的值（用于调试）
                Serial.print("Trimmed motor command: [");
                Serial.print(receivedValue);
                Serial.println("]");
                
                if (receivedValue == "M0") {
                    Serial.println("Stopping motor");
                    motorActive = false;
                    digitalWrite(MOTOR_PIN, LOW);
                } else if (receivedValue == "M") {
                    Serial.println("Single vibration (M)");
                    startMotorVibration(millis(), 0);  // 单次震动
                } else if (receivedValue == "M2") {
                    Serial.println("Double vibration (M2)");
                    startMotorVibration(millis(), 1);  // 两次震动
                } else if (receivedValue == "M3") {
                    Serial.println("Triple vibration (M3)");
                    startMotorVibration(millis(), 2);  // 三次震动
                } else if (receivedValue == "M4") {
                    Serial.println("Continuous vibration (M4)");
                    startMotorVibration(millis(), 3);  // 持续震动
                } else {
                    Serial.print("Unknown motor command: ");
                    Serial.println(receivedValue);
                }
            }
            // 可以加一个简单的响应机制，如果需要的话，比如通过另一个只读特征值
            // pCharacteristic->setValue("CMD_OK"); // Example response
            // pCharacteristic->notify(); // If client subscribed
        }
    }
};
// ------------------------------------


// ====== 初始化函数 ======
void setup() {
  Serial.begin(UART_BAUD);
  while (!Serial);
  Serial.println("System Initialization - BLE Version");
  
  // 显示测试帮助信息
  Serial.println("\n=== 马达测试 ===");
  Serial.println("通过串口发送以下命令测试马达：");
  Serial.println("1 - 单次震动 (M)");
  Serial.println("2 - 两次震动 (M2)");
  Serial.println("3 - 三次震动 (M3)");
  Serial.println("4 - 持续震动 (M4)");
  Serial.println("0 - 停止震动");
  Serial.println("h - 显示帮助");
  Serial.println("==============\n");

  // 初始化 MPU6050
  initMPU();

  // 初始化 LED 灯带
  strip.begin();
  strip.setBrightness(10); // 设置全局亮度为 10 (范围 0-255)
  
  strip.clear(); // 先清除所有灯珠
  strip.show(); // 立即显示
  
  // 然后设置初始LED模式（其中会再次确保指定灯珠常亮）
  setLedMode(ledMode);

  // 初始化按钮引脚
  pinMode(BUTTON_PIN, INPUT_PULLUP); // 假设使用内部上拉

  // 初始化马达引脚
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW); // 确保马达初始状态为关闭

  // -------- 移除/注释掉 网络初始化代码 --------
  // Serial.println("Connecting to WiFi...");
  // connectToWiFi(); // 尝试连接WiFi

  // if (WiFi.status() != WL_CONNECTED) {
  //   Serial.println("WiFi connection failed. Setting up AP mode.");
  //   setupAccessPoint(); // 如果WiFi连接失败，则启动AP模式
  // } else {
  //   Serial.print("Connected to WiFi. IP address: ");
  //   Serial.println(WiFi.localIP());
  //   if (MDNS.begin(mdnsHostName)) {
  //     Serial.print("MDNS responder started: http://");
  //     Serial.print(mdnsHostName);
  //     Serial.println(".local");
  //   }
  // }
  // initWebSocket(); // 初始化WebSocket
  // setupRoutes();   // 设置Web服务器路由
  // server.begin();  // 启动Web服务器
  // Serial.println("HTTP server and WebSocket started.");
  // ----------------------------------------------------

  // ====== 新增 BLE 初始化代码 ======
  Serial.println("Starting BLE setup...");
  BLEDevice::init("ESP32_Scene_Control"); // BLE 设备名称

  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyBLEServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristicCommand = pService->createCharacteristic(
                                     CHARACTERISTIC_UUID_COMMAND,
                                     BLECharacteristic::PROPERTY_READ |
                                     BLECharacteristic::PROPERTY_WRITE |
                                     BLECharacteristic::PROPERTY_NOTIFY // 可选，如果想让客户端知道命令值变化
                                   );
  pCharacteristicCommand->setCallbacks(new MyCommandCharacteristicCallbacks());
  pCharacteristicCommand->setValue("ESP32 Ready"); // 设置初始值 (可选)

  // Create MPU6050 Data Characteristic
  pMpuCharacteristic = pService->createCharacteristic(
                       MPU_CHARACTERISTIC_UUID,
                       BLECharacteristic::PROPERTY_READ |
                       BLECharacteristic::PROPERTY_NOTIFY
                     );
  pMpuCharacteristic->addDescriptor(new BLEDescriptor(BLEUUID((uint16_t)0x2902))); // 允许客户端接收通知

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  // 下面这些参数有助于iOS设备连接
  pAdvertising->setMinPreferred(0x06);  
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("BLE Service started. Advertising...");
  // ------------------------------------

  Serial.println("System Initialization Complete.");
  lastStatusTime = millis(); // 初始化状态打印计时器
}

// ====== 各模块初始化细节 ======\nvoid initMPU() {
// （保留您原有的 initMPU 函数内容）
// ...
void initMPU() {
  Serial.println("Initializing MPU6050...");
  if (!mpu.begin()) {
    Serial.println("Failed to find MPU6050 chip");
    // 可以考虑在此处卡住或设置错误状态
    while (1) {
      delay(10);
    }
  }
  Serial.println("MPU6050 Found!");

  // 设置加速度计量程 (根据需要选择)
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  // 设置陀螺仪量程
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  // 设置滤波器带宽
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  delay(100);
}


// ====== 循环函数 ======\n
// 测试马达震动的函数
void testMotorVibration() {
  if (Serial.available() > 0) {
    char command = Serial.read();
    
    switch(command) {
      case '1':
        Serial.println("测试: 单次震动 (M)");
        startMotorVibration(millis(), 0);
        break;
      case '2':
        Serial.println("测试: 两次震动 (M2)");
        startMotorVibration(millis(), 1);
        break;
      case '3':
        Serial.println("测试: 三次震动 (M3)");
        startMotorVibration(millis(), 2);
        break;
      case '4':
        Serial.println("测试: 持续震动 (M4)，按'0'停止");
        startMotorVibration(millis(), 3);
        break;
      case '0':
        Serial.println("停止所有震动");
        motorActive = false;
        digitalWrite(MOTOR_PIN, LOW);
        break;
      case 'h':
        Serial.println("\n=== 马达测试帮助 ===");
        Serial.println("1 - 单次震动 (M)");
        Serial.println("2 - 两次震动 (M2)");
        Serial.println("3 - 三次震动 (M3)");
        Serial.println("4 - 持续震动 (M4)");
        Serial.println("0 - 停止震动");
        Serial.println("h - 显示帮助");
        Serial.println("=================\n");
        break;
      case '\n':
      case '\r':
        // 忽略换行符
        break;
      default:
        Serial.println("未知命令，按'h'查看帮助");
    }
  }
}

void loop() {
  unsigned long currentTime = millis();

  // 处理LED动画
  handleLED(currentTime);

  // 处理马达震动
  handleMotor(currentTime);
  
  // 测试马达震动
  testMotorVibration();

  // 检测按钮状态
  checkButton(currentTime);



  // 定期处理MPU数据（当前仅串口输出，后续改为BLE发送）
  if (currentTime - lastMpuTime >= 200) { // 例如每200ms处理一次
    lastMpuTime = currentTime;
    readMPU6050Data(); // Update MPU data handling to use BLE
  }
  
  // ...其他代码...
}



// 设置 LED 模式
void setLedMode(int mode) {
  ledMode = mode;
  
  // 根据模式设置 LED 状态
  switch (ledMode) {
    case 0: // 关闭
      strip.clear();
      shouldAnimate = false;
      break;
    case 1: // 红色常亮
      constantColor(strip.Color(255, 0, 0));
      shouldAnimate = false;
      break;
    case 2: // 蓝色常亮
      constantColor(strip.Color(0, 0, 255));
      shouldAnimate = false;
      break;
    case 3: // 绿色常亮
      constantColor(strip.Color(0, 255, 0));
      shouldAnimate = false;
      break;
    case 4: // 红色带尾巴转圈
      strip.clear();
      shouldAnimate = true;
      currentLed = 0;
      break;
    case 5: // 蓝色带尾巴转圈
      strip.clear();
      shouldAnimate = true;
      currentLed = 0;
      break;
    default:
      strip.clear();
      shouldAnimate = false;
      break;
  }
  

  strip.show();
  
  Serial.print("设置 LED 模式为: ");
  Serial.println(ledMode);
}

// 处理 LED 动画
void handleLED(unsigned long currentTime) {
  // 如果不需要动画，直接返回
  if (!shouldAnimate) {
    return;
  }
  
  // 检查是否到了动画更新时间
  if (currentTime - previousLedMillis >= animationInterval) {
    previousLedMillis = currentTime;
    
    // 清除所有灯珠
    strip.clear();
    
    // 根据模式设置颜色
    uint32_t color;
    if (ledMode == 4) {
      color = strip.Color(255, 0, 0); // 红色
    } else {
      color = strip.Color(0, 0, 255); // 蓝色
    }
    
    // 设置当前 LED 和尾巴
    for (int i = 0; i < TAIL_LENGTH; i++) {
      int pos = (currentLed - i) % NUMPIXELS;
      if (pos < 0) pos += NUMPIXELS;
      
      // 设置逐渐减弱的亮度
      int brightness = 255 * (TAIL_LENGTH - i) / TAIL_LENGTH;
      uint32_t tailColor = strip.Color(
        red(color) * brightness / 255,
        green(color) * brightness / 255,
        blue(color) * brightness / 255
      );
      
      strip.setPixelColor(pos, tailColor);
    }
    
    // 更新当前 LED 位置
    currentLed = (currentLed + 1) % NUMPIXELS;
    

    
    // 显示更新后的灯珠状态
    strip.show();
  }
}

// 设置所有灯珠为同一颜色
void constantColor(uint32_t c) {
  for (int i = 0; i < NUMPIXELS; i++) {
    strip.setPixelColor(i, c);
  }
  strip.show();
}

// 处理马达震动
void handleMotor(unsigned long currentTime) {
  // 如果马达不活动，直接返回
  if (!motorActive) {
    return;
  }
  
  // 如果需要持续震动（类型3）
  if (totalVibrations == 0) {
    digitalWrite(MOTOR_PIN, HIGH);
    return;
  }
  
  // 处理有限次数的震动
  if (currentTime - lastVibrationTime >= (digitalRead(MOTOR_PIN) == HIGH ? vibrationDuration : vibrationInterval)) {
    lastVibrationTime = currentTime;
    
    if (digitalRead(MOTOR_PIN) == HIGH) {
      // 当前震动结束，关闭马达
      digitalWrite(MOTOR_PIN, LOW);
      
      // 检查是否完成所有震动
      vibrationCount++;
      if (vibrationCount >= totalVibrations) {
        motorActive = false;
        vibrationCount = 0;
        Serial.println("震动完成");
      }
    } else {
      // 开始下一次震动
      digitalWrite(MOTOR_PIN, HIGH);
    }
  }
}

// 开始马达震动
void startMotorVibration(unsigned long currentTime, int type) {
  motorActive = true;
  vibrationCount = 0;
  lastVibrationTime = currentTime;
  
  // 根据类型设置震动次数
  switch (type) {
    case 0: // 单次震动
      totalVibrations = 1;
      break;
    case 1: // 两次震动
      totalVibrations = 2;
      break;
    case 2: // 三次震动
      totalVibrations = 3;
      break;
    case 3: // 持续震动
      totalVibrations = 0; // 0 表示持续震动
      break;
    default:
      totalVibrations = 1;
      break;
  }
  
  // 立即开始震动
  digitalWrite(MOTOR_PIN, HIGH);
  
  Serial.print("开始震动，类型: ");
  Serial.println(type);
}

// 检测按钮状态
void checkButton(unsigned long currentTime) {
  // 读取当前按钮状态
  int reading = digitalRead(BUTTON_PIN);
  
  // 如果按钮状态变化，重置消抖计时器
  if (reading != lastButtonState) {
    lastDebounceTime = currentTime;
  }
  
  // 如果按钮状态稳定超过消抖时间
  if ((currentTime - lastDebounceTime) > debounceDelay) {
    // 如果按钮被按下（低电平）
    if (reading == LOW) {
      // 切换 LED 模式
      int newMode = (ledMode + 1) % 6; // 循环切换 0-5 模式
      setLedMode(newMode);
      
      // 发送按钮事件（如果需要）
      Serial.println("按钮被按下，切换 LED 模式");
      
      // 可以在这里添加通过 BLE 发送按钮状态的代码
    }
  }
  
  // 保存当前按钮状态供下次比较
  lastButtonState = reading;
}

// 读取 MPU6050 数据
void readMPU6050Data() {
  // 获取新的传感器事件
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  
  // 如果有 BLE 连接且时间到了，发送 MPU 数据
  if (bleDeviceConnected && millis() - lastMpuNotifyTime >= mpuNotifyInterval) {
    lastMpuNotifyTime = millis();
    
    // 创建 JSON 字符串来发送数据
    char mpuData[100];
    sprintf(mpuData, "{\"ax\":%.2f,\"ay\":%.2f,\"az\":%.2f,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f}", 
            a.acceleration.x, a.acceleration.y, a.acceleration.z,
            g.gyro.x, g.gyro.y, g.gyro.z);
    
    // 设置特征值并发送通知
    if (pMpuCharacteristic != nullptr) {
      pMpuCharacteristic->setValue(mpuData);
      pMpuCharacteristic->notify();
    }
  }
  
  // 在串口输出传感器数据（用于调试）
  if (millis() - lastStatusTime >= statusInterval) {
    lastStatusTime = millis();
    
    Serial.print("Acceleration (m/s^2): ");
    Serial.print(a.acceleration.x); Serial.print(", ");
    Serial.print(a.acceleration.y); Serial.print(", ");
    Serial.print(a.acceleration.z); Serial.println("");
    
    Serial.print("Rotation (rad/s): ");
    Serial.print(g.gyro.x); Serial.print(", ");
    Serial.print(g.gyro.y); Serial.print(", ");
    Serial.print(g.gyro.z); Serial.println("");
    
    Serial.print("Temperature: ");
    Serial.print(temp.temperature);
    Serial.println(" degC");
    Serial.println("");
  }
}

// 从颜色值中提取红色分量
uint8_t red(uint32_t colorVal) {
  return (colorVal >> 16) & 0xFF;
}

// 从颜色值中提取绿色分量
uint8_t green(uint32_t colorVal) {
  return (colorVal >> 8) & 0xFF;
}

// 从颜色值中提取蓝色分量
uint8_t blue(uint32_t colorVal) {
  return colorVal & 0xFF;
}


// -------- 移除/注释掉 所有 WiFi 和 WebSocket 相关函数实现 --------
/*
// ====== WiFi连接函数 ======\nvoid connectToWiFi() { ... }
// 配置AP模式（当WiFi连接失败时使用）\nvoid setupAccessPoint() { ... }
// 设置Web服务器路由\nvoid setupRoutes() { ... }
// 初始化WebSocket\nvoid initWebSocket() { ... }
// WebSocket事件处理\nvoid onWebSocketEvent(...) { ... }
// 处理WebSocket消息 - 这是主要的命令处理中心\nvoid handleWebSocketMessage(...) { ... }
// 发送按钮状态\nvoid sendButtonState(AsyncWebSocketClient *client) { ... }
// 发送MPU6050数据\nvoid sendMPUData(AsyncWebSocketClient *client) { ... }
// 广播MPU6050数据（仅当开启自动发送时使用）\nvoid broadcastMPUData() { ... }
// 发送设备当前状态\nvoid sendDeviceStatus(AsyncWebSocketClient *client) { ... }
// 广播动作完成事件（预留函数，当前不使用）\nvoid broadcastActionCompleted(int actionId) { ... }
*/
// -----------------------------------------------------------------
