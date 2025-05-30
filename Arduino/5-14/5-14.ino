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
  strip.show();            // 初始化时清除所有像素 (熄灭)
  strip.setBrightness(10); // 设置全局亮度为 10 (范围 0-255)
  setLedMode(ledMode); // 设置初始LED模式

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
  
  // -------- 移除/注释掉 WebSocket 清理和广播代码 --------
  // ws.cleanupClients(); // 定期清理断开的WebSocket客户端
  // if (automaticDataSending && (currentTime - lastSensorDataTime >= SENSOR_DATA_INTERVAL)) {
  //   if (connectedClients > 0) {
  //     // broadcastMPUData(); // 广播MPU数据给所有连接的客户端
  //     lastSensorDataTime = currentTime;
  //   }
  // }
  // ----------------------------------------------------

  // ====== 新增 BLE 连接状态管理和数据发送（占位） ======
  if (bleDeviceConnected && !oldBleDeviceConnected) {
      oldBleDeviceConnected = bleDeviceConnected; // Should be set in onConnect
      // 可以在这里做一些设备刚连接上的操作
  }
  if (!bleDeviceConnected && oldBleDeviceConnected) {
      oldBleDeviceConnected = bleDeviceConnected; // Should be set in onDisconnect
      Serial.println("Device was disconnected (loop check).");
      // 可能需要停止某些依赖连接的操作
  }
  // 后续在这里添加通过BLE发送MPU数据、按钮状态等的逻辑
  // 例如:
  // if (bleDeviceConnected && automaticDataSending && (currentTime - lastSensorDataTime >= SENSOR_DATA_INTERVAL)) {
  //   // sendMPUDataViaBLE(); // 新的函数
  //   lastSensorDataTime = currentTime;
  // }
  // ----------------------------------------------------


  // 定期打印状态到串口 (调试用)
  if (currentTime - lastStatusTime >= statusInterval) {
    lastStatusTime = currentTime;
    // printStatus(); // 这个函数可以保留用于本地调试
  }

  delay(10); // 短暂延时，给系统其他任务时间
}


// ====== 各模块处理函数细节 ======\n
// 打印系统状态（仅串口输出） - 可以保留用于调试
void printStatus() {
// (保留您原有的 printStatus 函数内容)
// ...
  Serial.println("--- System Status ---");
  Serial.print("LED Mode: ");
  Serial.println(ledMode);
  Serial.print("Motor Active: ");
  Serial.println(motorActive ? "Yes" : "No");
  Serial.print("Button State: ");
  Serial.println(digitalRead(BUTTON_PIN) == LOW ? "Pressed" : "Released");
  Serial.print("Uptime: ");
  Serial.print(millis() / 1000);
  Serial.println(" s");
  // -------- 移除/注释掉 网络相关状态 --------
  // Serial.print("WiFi Status: ");
  // Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
  // if (WiFi.status() == WL_CONNECTED) {
  //   Serial.print("IP Address: ");
  //   Serial.println(WiFi.localIP());
  // }
  // Serial.print("WebSocket Clients: ");
  // Serial.println(connectedClients);
  // Serial.print("Automatic Data Sending: ");
  // Serial.println(automaticDataSending ? "Enabled" : "Disabled");
  // ----------------------------------------------------
  Serial.print("BLE Connected: ");
  Serial.println(bleDeviceConnected ? "Yes" : "No");
  Serial.println("---------------------");
}


// 处理MPU6050传感器数据并通过BLE发送
void readMPU6050Data() { // Renamed from handleMPU and logic updated
    unsigned long currentTime = millis();
    // Check if BLE device is connected, characteristic exists, and it's time to send data
    if (bleDeviceConnected && pMpuCharacteristic != nullptr && (currentTime - lastMpuNotifyTime >= mpuNotifyInterval)) {
        lastMpuNotifyTime = currentTime;

        sensors_event_t a, g, temp;
        mpu.getEvent(&a, &g, &temp); // Read MPU6050 sensor data

        // Prepare data string, e.g., "ax:1.0,ay:2.0,az:9.8,gx:0.1,gy:0.0,gz:0.2"
        char mpuDataString[100]; // Ensure buffer is large enough
        snprintf(mpuDataString, sizeof(mpuDataString),
                 "ax:%.2f,ay:%.2f,az:%.2f,gx:%.2f,gy:%.2f,gz:%.2f",
                 a.acceleration.x, a.acceleration.y, a.acceleration.z,
                 g.gyro.x, g.gyro.y, g.gyro.z);

        pMpuCharacteristic->setValue(mpuDataString);
        pMpuCharacteristic->notify(); // Send data via BLE notification

        // Optional: Print to Serial for debugging
        // Serial.print("Sent MPU Data via BLE: ");
        // Serial.println(mpuDataString);
    }
}


// 检测按钮状态 - 简化消抖逻辑，直接检测按钮状态并发送命令
void checkButton(unsigned long currentTime) {
  static unsigned long lastButtonActionTime = 0;
  static bool lastButtonState = HIGH;
  bool currentButtonState = digitalRead(BUTTON_PIN);
  
  // 如果按钮状态变化，更新状态并记录时间
  if (currentButtonState != lastButtonState) {
    lastButtonState = currentButtonState;
    
    // 按钮被按下（LOW 因为使用上拉电阻）
    if (currentButtonState == LOW) {
      // 防止重复触发，至少间隔500ms
      if (currentTime - lastButtonActionTime > 500) {
        lastButtonActionTime = currentTime;
        
        // 发送KEY1命令到前端
        if (bleDeviceConnected && pMpuCharacteristic) {
          // 发送JSON格式的命令
          String jsonCommand = "{\"type\":\"button\",\"key\":\"KEY1\"}";
          pMpuCharacteristic->setValue(jsonCommand.c_str());
          pMpuCharacteristic->notify();
          
          // 同时发送简单的KEY1字符串，确保兼容性
          pMpuCharacteristic->setValue("KEY1");
          pMpuCharacteristic->notify();
          
          Serial.print("Button pressed: Sent KEY1 command: ");
          Serial.println(jsonCommand);
        } else {
          Serial.println("Button pressed but not connected or MPU characteristic not available");
          if (!bleDeviceConnected) {
            Serial.println("Device not connected");
          }
          if (!pMpuCharacteristic) {
            Serial.println("MPU characteristic not available");
          }
        }
      }
    }
  }
}

// 启动马达震动
// type: 0=单次震动, 1=两次震动, 2=三次震动, 3=持续震动
void startMotorVibration(unsigned long currentTime, int type) {
  if (motorActive) {
    Serial.println("Motor already active, ignoring new command");
    return;
  }
  
  motorActive = true;
  vibrationCount = 0;
  
  switch(type) {
    case 0:  // M - 单次震动
      totalVibrations = 1;
      break;
    case 1:  // M2 - 两次震动
      totalVibrations = 2;
      break;
    case 2:  // M3 - 三次震动
      totalVibrations = 3;
      break;
    case 3:  // M4 - 持续震动
      totalVibrations = -1;  // -1 表示持续震动
      break;
    default:
      totalVibrations = 1;  // 默认单次震动
  }
  
  lastVibrationTime = currentTime;
  digitalWrite(MOTOR_PIN, HIGH);
  Serial.print("Motor vibration started. Type: ");
  Serial.println(type);
}

// 处理马达震动状态
void handleMotor(unsigned long currentTime) {
  static unsigned long lastDebugTime = 0;
  
  if (!motorActive) return;
  
  // 每500ms输出一次调试信息
  if (currentTime - lastDebugTime >= 500) {
    lastDebugTime = currentTime;
    Serial.print("Motor state - Active: ");
    Serial.print(motorActive);
    Serial.print(", Pin state: ");
    Serial.print(digitalRead(MOTOR_PIN));
    Serial.print(", Vibration count: ");
    Serial.print(vibrationCount);
    Serial.print("/");
    Serial.print(totalVibrations * 2);
    Serial.print(", Total vibs: ");
    Serial.println(totalVibrations);
  }
  
  unsigned long elapsed = currentTime - lastVibrationTime;
  bool isMotorOn = digitalRead(MOTOR_PIN) == HIGH;
  
  // 持续震动模式 (M4)
  if (totalVibrations == -1) {
    if (isMotorOn && elapsed >= vibrationDuration) {
      digitalWrite(MOTOR_PIN, LOW);
      lastVibrationTime = currentTime;
      Serial.println("M4: Motor OFF");
    } else if (!isMotorOn && elapsed >= vibrationInterval) {
      digitalWrite(MOTOR_PIN, HIGH);
      lastVibrationTime = currentTime;
      Serial.println("M4: Motor ON");
    }
    return;
  }
  
  // 有限次震动模式 (M, M2, M3)
  if (vibrationCount >= totalVibrations * 2) {
    // 震动完成
    motorActive = false;
    digitalWrite(MOTOR_PIN, LOW);
    Serial.print("Motor vibration completed. Total pulses: ");
    Serial.println(vibrationCount);
    return;
  }
  
  // 处理震动状态切换
  if (isMotorOn && elapsed >= vibrationDuration) {
    digitalWrite(MOTOR_PIN, LOW);
    lastVibrationTime = currentTime;
    vibrationCount++;
    Serial.print("Pulse OFF, count: ");
    Serial.println(vibrationCount);
  } else if (!isMotorOn && elapsed >= vibrationInterval) {
    digitalWrite(MOTOR_PIN, HIGH);
    lastVibrationTime = currentTime;
    vibrationCount++;
    Serial.print("Pulse ON, count: ");
    Serial.println(vibrationCount);
  }
}

// 设置 LED 模式 - 此函数可以保留，并由BLE命令调用
void setLedMode(int mode) {
// (保留您原有的 setLedMode 函数内容)
// ...
  ledMode = mode;
  shouldAnimate = false; // 默认停止动画，除非是动画模式
  currentLed = 0;      // 重置动画起始点

  switch (ledMode) {
    case 0: // 关闭
      constantColor(strip.Color(0, 0, 0));
      Serial.println("LED Mode: OFF");
      break;
    case 1: // 红色常亮
      constantColor(strip.Color(255, 0, 0));
      Serial.println("LED Mode: RED Constant");
      break;
    case 2: // 蓝色常亮
      constantColor(strip.Color(0, 0, 255));
      Serial.println("LED Mode: BLUE Constant");
      break;
    case 3: // 绿色常亮
      constantColor(strip.Color(0, 255, 0));
      Serial.println("LED Mode: GREEN Constant");
      break;
    case 4: // 红色带尾巴转圈
    case 5: // 蓝色带尾巴转圈
      shouldAnimate = true;
      previousLedMillis = millis(); // 准备开始动画
      Serial.print("LED Mode: Animation "); Serial.println(ledMode);
      break;
    default:
      Serial.print("Unknown LED Mode: "); Serial.println(mode);
      ledMode = 0; // 默认为关闭
      constantColor(strip.Color(0, 0, 0));
      break;
  }
}


// 处理LED动画 - 此函数可以保留
uint8_t red(uint32_t colorVal);
uint8_t green(uint32_t colorVal);
uint8_t blue(uint32_t colorVal);

void handleLED(unsigned long currentTime) {
// (保留您原有的 handleLED 函数内容)
// ...
  if (shouldAnimate && (currentTime - previousLedMillis >= animationInterval)) {
    previousLedMillis = currentTime; // 更新上次动画时间

    strip.clear(); // 清除之前的帧

    uint32_t base_color_val; // Changed variable name to avoid conflict with blue() function
    if (ledMode == 4) { // 红色动画
      base_color_val = strip.Color(255, 0, 0);
    } else if (ledMode == 5) { // 蓝色动画
      base_color_val = strip.Color(0, 0, 255);
    } else {
      return; // 非动画模式不处理
    }

    // 绘制尾巴
    for (int i = 0; i < TAIL_LENGTH; i++) {
      int ledIndex = (currentLed - i + NUMPIXELS) % NUMPIXELS;
      // 亮度随尾巴减弱 (简单线性减弱)
      // Now calls the globally defined red, green, blue functions
      uint8_t brightness_r = red(base_color_val) * (TAIL_LENGTH - i) / TAIL_LENGTH;
      uint8_t brightness_g = green(base_color_val) * (TAIL_LENGTH - i) / TAIL_LENGTH;
      uint8_t brightness_b = blue(base_color_val) * (TAIL_LENGTH - i) / TAIL_LENGTH;
      strip.setPixelColor(ledIndex, strip.Color(brightness_r, brightness_g, brightness_b));
    }
    
    strip.show();
    currentLed = (currentLed + 1) % NUMPIXELS; // 移动到下一个LED
  }
}

// 从颜色值中提取红色分量
// Old red, green, blue helper functions with 'uint32_t color' parameter removed to avoid redefinition.


// 设置灯带为常亮颜色并显示 - 此函数可以保留
void constantColor(uint32_t c) {
// (保留您原有的 constantColor 函数内容)
// ...
  for (int i = 0; i < NUMPIXELS; i++) {
    strip.setPixelColor(i, c);
  }
  strip.show();
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
