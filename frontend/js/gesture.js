/**
 * gesture.js - 处理手势识别和匹配
 * 使用BLE连接与ESP32通信，接收MPU6050数据并进行手势匹配
 */

// 全局变量
let isRecording = false;
let currentData = [];
let currentActionType = 'cup'; // 默认动作类型：cup, knife, phone, monitor
let esp32Connection = null; // BLE连接对象
const MAX_SAMPLES = 20; // 保持与参考数据相同的数据点数量
let matchResult = { matchPercentage: 0, level: '未匹配' };
let isGestureUIInitialized = false;

// 全局函数：处理从MPU6050接收到的数据
window.processMPUData = function(payload) {
    console.log('处理MPU数据:', payload);
    
    // 如果不在记录状态，直接返回
    if (!isRecording) {
        console.log('当前不在记录状态，忽略MPU数据');
        return;
    }
    
    // 确保当前阶段已设置
    if (!window.currentStage) {
        // 尝试从URL或当前显示的容器推断当前阶段
        const containers = [
            'stage4-1-1-container',
            'stage4-2-1-container',
            'stage4-3-1-container',
            'stage4-4-1-container'
        ];
        
        for (const id of containers) {
            const container = document.getElementById(id);
            if (container && container.style.display !== 'none') {
                window.currentStage = id.replace('-container', '');
                console.log(`从容器推断当前阶段: ${window.currentStage}`);
                break;
            }
        }
        
        // 如果仍然无法确定阶段，默认为stage4-1-1
        if (!window.currentStage) {
            window.currentStage = 'stage4-1-1';
            console.log('无法确定当前阶段，默认设置为stage4-1-1');
        }
    }
    
    // 解析MPU数据
    let mpuData;
    
    if (typeof payload === 'string') {
        // 解析字符串格式的MPU数据，例如 'ax:10.01,ay:-0.69,az:3.05,gx:-0.44,gy:0.33,gz:-0.94'
        try {
            const parts = payload.split(',');
            const values = {};
            
            for (const part of parts) {
                const [key, value] = part.split(':');
                values[key] = parseFloat(value);
            }
            
            mpuData = {
                accel: {
                    x: values.ax || 0,
                    y: values.ay || 0,
                    z: values.az || 0
                },
                gyro: {
                    x: values.gx || 0,
                    y: values.gy || 0,
                    z: values.gz || 0
                },
                timestamp: Date.now()
            };
            
            console.log('解析的MPU数据:', mpuData);
        } catch (error) {
            console.error('解析MPU数据字符串时出错:', error, payload);
            return;
        }
    } else if (typeof payload === 'object') {
        // 如果已经是对象格式
        mpuData = {
            accel: {
                x: payload.ax || payload.accel?.x || 0,
                y: payload.ay || payload.accel?.y || 0,
                z: payload.az || payload.accel?.z || 0
            },
            gyro: {
                x: payload.gx || payload.gyro?.x || 0,
                y: payload.gy || payload.gyro?.y || 0,
                z: payload.gz || payload.gyro?.z || 0
            },
            timestamp: Date.now()
        };
    } else {
        console.error('无法识别的MPU数据格式:', payload);
        return;
    }
    
    // 将数据添加到当前数据数组
    currentData.push(mpuData);
    console.log(`已添加MPU数据到当前数据数组，当前长度: ${currentData.length}`);
    
    // 如果收集了足够的数据点，自动停止记录
    if (currentData.length >= MAX_SAMPLES) {
        console.log(`已收集${currentData.length}个数据点，自动停止记录`);
        finishRecording();
    }
};

// 不同动作的参考数据
const referenceGestures = {
  // 喝水动作参考数据
  cup: [
    [-9.75, -1.02, 0.57,  0.12,  0.35, -0.25],
    [-9.29, -1.71, 0.68, -0.02,  0.03, -0.09],
    [-9.27, -1.60, 1.02,  0.03, -0.21,  0.14],
    [-9.57, -1.23, 0.62,  0.07,  0.23,  0.24],
    [-9.47, -1.63, 0.58, -0.06,  0.05,  0.01],
    [-9.83, -1.13, 0.41, -0.17, -0.12, -0.06],
    [-10.55, -1.31, 0.63,  0.04,  0.06,  0.49],
    [-10.70, -0.50, 0.82,  0.17,  0.13,  1.06],
    [-9.27,  0.48, 0.28,  0.24,  0.09,  1.50],
    [-9.73,  1.85, 0.46,  0.31, -0.11,  1.19],
    [-9.11,  3.16, 0.50,  0.17, -0.17,  1.19],
    [-9.18,  4.19, 0.42,  0.09, -0.20,  1.36],
    [-7.73,  5.32, 0.24,  0.14, -0.08,  1.55],
    [-6.35,  6.20, 0.40,  0.05, -0.22,  1.11],
    [-5.74,  7.08, 0.48,  0.11, -0.29,  1.09],
    [-4.81,  7.78, 0.45,  0.08, -0.20,  1.05],
    [-3.68,  8.25, 0.36,  0.04, -0.21,  0.94],
    [-2.96,  8.13, 0.74,  0.21,  0.03,  1.18],
    [-1.25,  9.01, 0.76,  0.36, -0.11,  1.07],
    [-1.22, 9.28, -0.22, 0.14, -0.16, 0.45]
  ],
  
  // 刀动作参考数据 (示例数据，需要替换为实际的刀动作数据)
  knife: [
    [-3.81, 9.58, -2.15, 0.20, 0.04, 0.50],
    [-1.89, 7.04, -2.79, 0.72, 0.00, 0.64],
    [-2.77, 0.87, -3.69, 0.95, -0.17, -0.78],
    [-4.55, -7.48, -5.07, 0.92, -0.50, -2.88],
    [-8.65, -12.97, -5.48, 0.19, -0.42, -3.75],
    [-9.76, -12.56, -5.48, -0.04, -0.50, -1.80],
    [-9.46, -9.74, -5.24, -0.12, -0.37, 1.31],
    [-8.19, -5.58, -5.36, 0.17, -0.71, 3.44],
    [-5.44, -1.49, -5.54, 0.19, -0.78, 3.68],
    [-2.67, 3.05, -4.87, 0.06, -0.70, 2.65],
    [-0.44, 6.62, -3.79, -0.16, -0.44, 1.09],
    [-0.30, 8.44, -2.54, -0.23, -0.14, 0.20],
    [-0.81, 9.08, -2.00, -0.12, 0.01, -0.14],
    [-1.50, 9.21, -1.83, -0.06, 0.04, -0.20],
    [-1.89, 9.16, -1.86, -0.00, 0.06, -0.14],
    [-2.06, 9.02, -1.90, -0.01, 0.04, -0.13],
    [-2.24, 8.93, -1.90, -0.03, 0.03, -0.11],
    [-2.40, 8.79, -1.93, -0.03, 0.03, -0.12],
    [-2.57, 8.66, -1.96, -0.04, 0.01, -0.10],
    [-2.64, 8.59, -1.97, -0.03, 0.00, -0.10]
  ],
  
  // 手机动作参考数据 (示例数据，需要替换为实际的手机动作数据)
  phone: [
    [-11.04, 2.26, 2.30, 0.97, -0.94, 0.70],
  [-9.39, 2.30, 1.64, 1.56, -1.13, 1.12],
  [-6.30, 2.29, 1.62, 1.07, -0.85, 1.73],
  [-0.84, 3.00, 0.62, 0.82, -0.45, 0.53],
  [-0.98, 3.67, 0.58, -0.27, 0.29, 0.10],
  [2.36, 5.57, 0.23, 0.41, -0.21, -0.85],
  [-1.42, 5.17, 0.60, 0.21, -0.26, -0.15],
  [3.68, 5.79, 1.25, 0.41, -0.66, 0.24],
  [-0.59, 5.21, 1.65, -0.20, -0.34, -0.23],
  [2.45, 5.58, 1.58, -0.48, -0.05, 0.78],
  [-0.08, 5.48, 0.73, -0.43, 0.07, -0.53],
  [-0.08, 5.25, 0.38, -0.27, 0.15, 0.52],
  [0.76, 5.35, 0.66, 0.01, -0.11, -0.29],
  [-0.52, 4.98, 1.04, -0.18, 0.09, -0.12],
  [0.96, 5.42, 1.11, -0.11, -0.13, -0.06],
  [0.01, 5.34, 0.67, -0.07, -0.08, -0.57],
  [0.31, 5.41, 0.97, 0.03, -0.35, 0.32],
  [0.94, 5.67, 1.31, 0.05, -0.39, -0.03],
  [-0.48, 5.52, 1.53, -0.30, -0.26, 0.22],
  [0.14, 5.75, 1.45, -0.42, -0.21, -0.19]
  ],
  
  // 监控器动作参考数据 (示例数据，需要替换为实际的监控器动作数据)
  monitor: [
    [-10.07, 0.60, -0.63, 1.20, 0.06, 1.55],
  [-7.70, -1.05, -0.24, 0.49, 0.25, 1.94],
  [-4.64, -2.99, -0.77, 0.17, 0.21, 1.95],
  [-1.28, -6.86, 2.56, -1.48, 0.36, 0.98],
  [-2.07, -9.48, 9.05, -1.08, 0.35, -0.08],
  [-3.33, -9.39, 10.63, -0.23, 0.47, -0.08],
  [-2.95, -7.18, 10.36, 0.85, 0.34, 0.24],
  [-2.20, -5.13, 7.80, 1.11, 0.37, 0.28],
  [-1.82, -5.87, 8.76, 0.28, 0.27, 0.16],
  [-1.88, -5.46, 8.75, 0.02, 0.38, 0.08],
  [-1.56, -4.40, 7.94, 0.33, 0.48, 0.20],
  [-1.76, -3.17, 8.55, 0.49, 0.53, 0.10],
  [-2.16, -3.35, 8.93, 0.01, 0.41, 0.14],
  [-2.29, -2.83, 7.75, -0.31, 0.42, 0.10],
  [-3.13, -1.91, 7.15, -0.24, 0.62, -0.06],
  [-4.08, -0.56, 5.79, 0.52, 0.76, -0.29],
  [-5.33, -0.20, 4.97, 0.17, 0.58, -0.30],
  [-6.08, -0.20, 4.32, 0.09, 0.41, -0.22],
  [-6.55, -0.18, 3.45, -0.06, 0.34, -0.11],
  [-6.71, -0.16, 3.23, -0.09, 0.28, -0.08]
  ]
};

// 获取当前动作类型的参考数据
function getReferenceData(actionType) {
  const gestureData = referenceGestures[actionType] || referenceGestures.cup;
  return gestureData.map(data => ({
    accel: { x: data[0], y: data[1], z: data[2] },
    gyro: { x: data[3], y: data[4], z: data[5] }
  }));
}

function calculateDistance(data1, data2) {
    console.log('开始计算距离，数据长度:', data1 ? data1.length : 0, data2 ? data2.length : 0);
    
    // 检查数据是否有效
    if (!data1 || !data2 || !data1.length || !data2.length) {
        console.warn('数据无效，无法计算距离');
        return {
            matchPercentage: 50, // 返回一个默认值
            level: '数据不足'
        };
    }
    
    const length = Math.min(data1.length, data2.length);
    if (length === 0) {
        console.warn('数据长度为0，无法计算距离');
        return {
            matchPercentage: 50,
            level: '数据不足'
        };
    }
    
    let totalDiff = 0;
    
    // 计算参考动作的特征
    let referenceFeatures = {
        maxAccel: 0.001, // 避免除以0
        avgAccel: 0,
        directionChanges: 0,
        prevAccel: null
    };
    
    try {
        // 首先分析参考数据的特征
        for (let i = 0; i < data1.length; i++) {
            const p = data1[i];
            if (!p || !p.accel) {
                console.warn(`参考数据第${i}项无效`);
                continue;
            }
            
            const accelMag = Math.sqrt(
                Math.pow(p.accel.x || 0, 2) + 
                Math.pow(p.accel.y || 0, 2) + 
                Math.pow(p.accel.z || 0, 2)
            );
            
            referenceFeatures.maxAccel = Math.max(referenceFeatures.maxAccel, accelMag);
            referenceFeatures.avgAccel += accelMag;
            
            if (referenceFeatures.prevAccel !== null) {
                if (((p.accel.x || 0) * (referenceFeatures.prevAccel.x || 0) < 0) ||
                    ((p.accel.y || 0) * (referenceFeatures.prevAccel.y || 0) < 0) ||
                    ((p.accel.z || 0) * (referenceFeatures.prevAccel.z || 0) < 0)) {
                    referenceFeatures.directionChanges++;
                }
            }
            referenceFeatures.prevAccel = p.accel;
        }
        
        // 避免除以0
        referenceFeatures.avgAccel = referenceFeatures.avgAccel / data1.length || 0.001;
        
        // 计算测试数据与参考特征的差异
        for (let i = 0; i < length; i++) {
            const p1 = data1[i];
            const p2 = data2[i];
            
            if (!p1 || !p2 || !p1.accel || !p2.accel || !p1.gyro || !p2.gyro) {
                console.warn(`数据第${i}项无效，跳过`);
                continue;
            }
            
            // 加速度方向差异
            const accelDiff = Math.sqrt(
                Math.pow((p1.accel.x || 0) - (p2.accel.x || 0), 2) +
                Math.pow((p1.accel.y || 0) - (p2.accel.y || 0), 2) +
                Math.pow((p1.accel.z || 0) - (p2.accel.z || 0), 2)
            );
            
            // 将差异标准化，基于参考动作的特征
            const normalizedDiff = accelDiff / referenceFeatures.maxAccel;
            
            // 陀螺仪差异
            const gyroDiff = Math.sqrt(
                Math.pow((p1.gyro.x || 0) - (p2.gyro.x || 0), 2) +
                Math.pow((p1.gyro.y || 0) - (p2.gyro.y || 0), 2) +
                Math.pow((p1.gyro.z || 0) - (p2.gyro.z || 0), 2)
            );
            
            totalDiff += (normalizedDiff * 0.8 + gyroDiff * 0.2) * 10;
        }
        
        // 修改匹配度计算公式
        const normalizedTotalDiff = totalDiff / (length * referenceFeatures.avgAccel);
        const matchPercentage = 100 * Math.exp(-0.5 * normalizedTotalDiff);
        
        // 对匹配度进行非线性映射
        const adjustedMatchPercentage = matchPercentage < 40 ? 
            matchPercentage : 
            40 + (matchPercentage - 40) * 1.5;
        
        // 确保不超过100%
        const finalMatchPercentage = Math.min(100, adjustedMatchPercentage);
        
        console.log('=================');
        console.log('计算结果:');
        console.log(`原始匹配度: ${matchPercentage.toFixed(1)}%`);
        console.log(`调整后匹配度: ${finalMatchPercentage.toFixed(1)}%`);
        console.log(`评价: ${getMatchLevel(finalMatchPercentage)}`);
        console.log('=================');
        
        return {
            matchPercentage: finalMatchPercentage,
            level: getMatchLevel(finalMatchPercentage)
        };
    } catch (error) {
        console.error('计算距离时发生错误:', error);
        return {
            matchPercentage: 50,
            level: '计算错误'
        };
    }
}

// 修改评价等级判断
function getMatchLevel(percentage) {
    if (percentage >= 85) {         // 原来是90
        return '完美匹配';
    } else if (percentage >= 70) {  // 原来是75
        return '非常接近';
    } else if (percentage >= 55) {  // 原来是60
        return '基本接近';
    } else if (percentage >= 35) {  // 原来是40
        return '有些差异';
    } else {
        return '差异较大';
    }
}

// 处理来自ESP32的MPU6050数据
function processMPUData(data) {
    try {
        let ax, ay, az, gx, gy, gz;
        
        // 处理不同格式的数据
        if (typeof data === 'string') {
            // 字符串格式: "ax,ay,az,gx,gy,gz"
            const values = data.split(',').map(v => parseFloat(v.trim()));
            if (values.length === 6 && values.every(v => !isNaN(v))) {
                [ax, ay, az, gx, gy, gz] = values;
            } else {
                return; // 无效数据
            }
        } else if (typeof data === 'object') {
            // JSON格式: {accel: {x, y, z}, gyro: {x, y, z}}
            if (data.accel && data.gyro) {
                ax = data.accel.x;
                ay = data.accel.y;
                az = data.accel.z;
                gx = data.gyro.x;
                gy = data.gyro.y;
                gz = data.gyro.z;
            } else {
                return; // 无效数据
            }
        } else {
            return; // 未知数据格式
        }
        
        // 更新UI显示
        updateUI(ax, ay, az, gx, gy, gz);
        
        // 如果正在记录，保存数据点
        if (isRecording && currentData.length < MAX_SAMPLES) {
            console.log(`记录数据点 ${currentData.length + 1}/${MAX_SAMPLES}:`);
            console.log(`[${ax.toFixed(2)}, ${ay.toFixed(2)}, ${az.toFixed(2)}, ${gx.toFixed(2)}, ${gy.toFixed(2)}, ${gz.toFixed(2)}]`);
            
            currentData.push({
                accel: { x: ax, y: ay, z: az },
                gyro: { x: gx, y: gy, z: gz }
            });
            
            if (currentData.length === MAX_SAMPLES) {
                finishRecording();
            }
        }
    } catch (error) {
        console.error('处理MPU数据失败:', error);
    }
}

function updateUI(ax, ay, az, gx, gy, gz) {
    // 更新UI显示，根据当前页面号选择对应元素
    document.getElementById(`accelX${currentPageNumber}`).textContent = ax.toFixed(2);
    document.getElementById(`accelY${currentPageNumber}`).textContent = ay.toFixed(2);
    document.getElementById(`accelZ${currentPageNumber}`).textContent = az.toFixed(2);
    document.getElementById(`gyroX${currentPageNumber}`).textContent = gx.toFixed(2);
    document.getElementById(`gyroY${currentPageNumber}`).textContent = gy.toFixed(2);
    document.getElementById(`gyroZ${currentPageNumber}`).textContent = gz.toFixed(2);

    // 在控制台输出坐标数据
    console.log(`加速度: X=${ax.toFixed(2)}, Y=${ay.toFixed(2)}, Z=${az.toFixed(2)}`);
    console.log(`陀螺仪: X=${gx.toFixed(2)}, Y=${gy.toFixed(2)}, Z=${gz.toFixed(2)}`);
}

function updateProgressBar(percentage) {
    console.log(`更新进度条，当前阶段: ${window.currentStage}，匹配度: ${percentage}%`);
    
    // 使用当前阶段作为ID的一部分
    const progressFill = document.getElementById(`progressFill-${window.currentStage}`);
    if (progressFill) {
        progressFill.style.width = `${percentage}%`;
        progressFill.classList.remove('high', 'medium', 'low');
        
        // 根据匹配度设置颜色
        if (percentage >= 70) {
            progressFill.style.backgroundColor = '#00ff00'; // 高匹配度，绿色
            progressFill.classList.add('high');
        } else if (percentage >= 40) {
            progressFill.style.backgroundColor = '#ffcc00'; // 中匹配度，黄色
            progressFill.classList.add('medium');
        } else {
            progressFill.style.backgroundColor = '#ff3300'; // 低匹配度，红色
            progressFill.classList.add('low');
        }
        
        console.log(`进度条宽度已更新为 ${percentage}%`);
    } else {
        console.warn(`未找到进度条元素 progressFill-${window.currentStage}`);
    }
    
    const progressLabel = document.getElementById(`progressLabel-${window.currentStage}`);
    if (progressLabel) {
        progressLabel.textContent = `Match: ${percentage.toFixed(1)}%`;
        console.log(`进度标签已更新为 ${percentage.toFixed(1)}%`);
    } else {
        console.warn(`未找到进度标签元素 progressLabel-${window.currentStage}`);
    }
}

function finishRecording() {
    // 确保当前阶段已设置
    if (!window.currentStage) {
        // 尝试从URL或当前显示的容器推断当前阶段
        const containers = [
            'stage4-1-1-container',
            'stage4-2-1-container',
            'stage4-3-1-container',
            'stage4-4-1-container'
        ];
        
        for (const id of containers) {
            const container = document.getElementById(id);
            if (container && container.style.display !== 'none') {
                window.currentStage = id.replace('-container', '');
                console.log(`从容器推断当前阶段: ${window.currentStage}`);
                break;
            }
        }
        
        // 如果仍然无法确定阶段，默认为stage4-1-1
        if (!window.currentStage) {
            window.currentStage = 'stage4-1-1';
            console.log('无法确定当前阶段，默认设置为stage4-1-1');
        }
    }
    
    console.log('完成手势记录，当前阶段:', window.currentStage);
    isRecording = false;
    
    // 检查数据是否有效
    if (!currentData || currentData.length === 0) {
        console.warn('没有收集到有效的手势数据');
        matchResult = { matchPercentage: 50, level: '数据不足' };
        // 显示结果
        showMatchResultInStage(matchResult);
        return;
    }
    
    // 获取当前动作类型的参考数据
    const referenceData = getReferenceData(currentActionType);
    console.log('当前动作类型:', currentActionType);
    console.log('当前数据长度:', currentData.length);
    
    // 计算匹配度
    matchResult = calculateDistance(referenceData, currentData);
    console.log('匹配结果:', matchResult);
    
    // 更新UI
    if (matchResult && typeof matchResult.matchPercentage === 'number' && !isNaN(matchResult.matchPercentage)) {
        updateProgressBar(matchResult.matchPercentage);
    } else {
        console.error('匹配结果无效，无法更新进度条');
        // 设置一个默认值
        matchResult = { matchPercentage: 50, level: '中等匹配' };
    }
    
    // 显示匹配结果
    showMatchResultInStage(matchResult);
    
    // 设置 LED 为绿色常亮并震动马达
    try {
        const esp32Obj = window.esp32GlobalBLEConnection; // Use the new global reference

        if (esp32Obj && typeof esp32Obj.isConnected === 'function' && esp32Obj.isConnected() && typeof esp32Obj.sendCommand === 'function') {
            // 设置 LED 为绿色常亮 (L3)
            console.log('finishRecording: ESP32 (global ref) connected. Sending L3 (green LED) command.');
            esp32Obj.sendCommand('L3');
            
            // 添加200ms延迟再发送马达命令
            setTimeout(() => {
                // Re-check connection AND existence of esp32Obj on window
                const currentEsp32Obj = window.esp32GlobalBLEConnection;
                if (currentEsp32Obj && currentEsp32Obj.isConnected()) {
                    console.log('finishRecording: ESP32 (global ref) connected. Sending M2 (motor - double vibration) command.');
                    currentEsp32Obj.sendCommand('M2');
                } else {
                    console.warn('finishRecording: ESP32 (global ref) disconnected or unavailable before M1 command.');
                }
            }, 200); // Increased delay to 500ms for testing
        } else {
            if (!esp32Obj) {
                console.warn('finishRecording: window.esp32GlobalBLEConnection is not defined.');
            } else if (typeof esp32Obj.isConnected !== 'function') {
                console.warn('finishRecording: window.esp32GlobalBLEConnection.isConnected is not a function.');
            } else if (!esp32Obj.isConnected()) {
                console.warn('finishRecording: ESP32 (global ref) is not connected. Cannot send commands.');
            } else if (typeof esp32Obj.sendCommand !== 'function') {
                console.warn('finishRecording: window.esp32GlobalBLEConnection.sendCommand is not a function.');
            }
            console.log('finishRecording: Could not send L3/M1 commands due to connection or object issues (using global ref).');
        }
    } catch (error) {
        console.error('ESP32 操作失败:', error);
    }
    
    // 清空当前数据
    currentData = [];
    console.log('手势记录完成并重置');
}

// 在stage4-x-1阶段显示匹配结果
async function showMatchResultInStage(matchResult) {
    console.log(`showMatchResultInStage called. Current window.currentStage: ${window.currentStage}. Match Result:`, matchResult);

    console.log('开始显示手势匹配结果，当前阶段:', window.currentStage);
    console.log('匹配结果:', matchResult);
    
    // 根据不同的stage确定动作类型
    let actionMessage;
    let stageContainer;
    
    switch(window.currentStage) {
        case 'stage4-1-1':
            stageContainer = document.getElementById('stage4-1-1-container');
            actionMessage = document.getElementById('action-reproduction-message');
            currentActionType = 'cup';
            break;
        case 'stage4-2-1':
            stageContainer = document.getElementById('stage4-2-1-container');
            actionMessage = document.getElementById('action-reproduction-message-stage4-2-1');
            currentActionType = 'knife';
            break;
        case 'stage4-3-1':
            stageContainer = document.getElementById('stage4-3-1-container');
            actionMessage = document.getElementById('action-reproduction-message-stage4-3-1');
            currentActionType = 'phone';
            break;
        case 'stage4-4-1':
            stageContainer = document.getElementById('stage4-4-1-container');
            actionMessage = document.getElementById('action-reproduction-message-stage4-4-1');
            currentActionType = 'monitor';
            break;
        default:
            console.warn('当前不在相关阶段，无法显示匹配结果');
            return; // 不在相关阶段
    }
    
    // 显示匹配度容器
    const matchContainer = stageContainer.querySelector('.gesture-match-container');
    if (matchContainer) {
        matchContainer.style.display = 'block';
        console.log('显示匹配度容器');
    }
    
    console.log('当前容器元素:', stageContainer);
    console.log('动作消息元素:', actionMessage);
    
    if (!stageContainer) {
        console.error(`未找到 ${window.currentStage}-container 元素！`);
        return;
    }
    
    if (!actionMessage) {
        console.error(`未找到动作消息元素！`);
        // 尝试创建一个消息元素
        actionMessage = document.createElement('p');
        actionMessage.id = 'action-reproduction-message';
        actionMessage.style.fontSize = '1.5em';
        actionMessage.style.color = '#00ccff';
        actionMessage.style.textAlign = 'center';
        actionMessage.style.margin = '20px 0';
        stageContainer.appendChild(actionMessage);
        console.log('创建了新的动作消息元素');
    }
    
    // 清除可能存在的类
    actionMessage.classList.remove('perfect-match', 'basic-match');
    
    // 添加内联样式，确保样式生效
    const perfectMatchStyle = 'color: #00ff00; text-shadow: 0 0 10px rgba(0, 255, 0, 0.7); font-size: 0.5em; animation: pulse 2s infinite;';
    const basicMatchStyle = 'color: #ffcc00; text-shadow: 0 0 10px rgba(255, 204, 0, 0.7); font-size: 0.5em;';
    
    // 根据匹配度显示不同的消息
    if (matchResult.matchPercentage >= 70) {
        actionMessage.textContent = 'Perfect reproduction, memory fragment unlocked';
        actionMessage.classList.add('perfect-match');
        actionMessage.style = perfectMatchStyle;
        console.log('显示完美匹配消息');
    } else {
        actionMessage.textContent = 'Basic reproduction, memory fragment unlocked';
        actionMessage.classList.add('basic-match');
        actionMessage.style = basicMatchStyle;
        console.log('显示基本匹配消息');
    }
    
    // 更新进度条
    const progressFill = document.getElementById(`progressFill-${window.currentStage}`);
    const progressLabel = document.getElementById(`progressLabel-${window.currentStage}`);
    
    if (progressFill) {
        progressFill.style.width = `${matchResult.matchPercentage}%`;
        
        // 根据匹配度设置颜色
        progressFill.classList.remove('high', 'medium', 'low');
        if (matchResult.matchPercentage >= 70) {
            progressFill.style.backgroundColor = '#00ff00'; // 高匹配度，绿色
        } else if (matchResult.matchPercentage >= 40) {
            progressFill.style.backgroundColor = '#ffcc00'; // 中匹配度，黄色
        } else {
            progressFill.style.backgroundColor = '#ff3300'; // 低匹配度，红色
        }
        
        // 更新匹配度标签样式
        if (progressLabel) {
            progressLabel.textContent = `Match: ${matchResult.matchPercentage.toFixed(1)}%`;
            progressLabel.style.fontSize = '0.8em';
            progressLabel.style.fontFamily = 'Arial, sans-serif';
        }
        
        console.log(`更新进度条宽度为 ${matchResult.matchPercentage}%`);
    } else {
        console.warn(`未找到 progressFill-${window.currentStage} 元素！`);
    }
    
    console.log('手势匹配结果显示完成');
    console.log('即将尝试播放音效。window.audioManager 状态:', window.audioManager);
    if (window.audioManager) {
        window.audioManager.playSound('showMatchScoreSound');
        console.log('已调用 playSound("showMatchScoreSound")');
    } else {
        console.error('window.audioManager 未定义，无法播放音效！');
    }

    // Logic for video feedback in action reproduction stages (e.g., stage4-1-1 for cup, stage4-2-1 for knife, stage4-3-1 for phone, stage4-4-1 for camera/monitor)
    if ((window.currentStage === 'stage4-1-1' || window.currentStage === 'stage4-2-1' || window.currentStage === 'stage4-3-1' || window.currentStage === 'stage4-4-1') && matchResult) {
        let videoSrc = '';
        const highMatchLevels = ['完美匹配', '非常接近']; // "基本接近" removed from high tier

        if (window.currentStage === 'stage4-1-1') {
            if (matchResult.level && highMatchLevels.includes(matchResult.level)) {
                videoSrc = 'assets/videos/cup_high.mp4';
            } else {
                videoSrc = 'assets/videos/cup_low.mp4';
            }
            console.log(`Stage 4-1-1 (Cup): Match level '${matchResult.level}', determined video: ${videoSrc}`);
        } else if (window.currentStage === 'stage4-2-1') {
            if (matchResult.level && highMatchLevels.includes(matchResult.level)) {
                videoSrc = 'assets/videos/knife_high.mp4';
            } else {
                videoSrc = 'assets/videos/knife_low.mp4';
            }
            console.log(`Stage 4-2-1 (Knife): Match level '${matchResult.level}', determined video: ${videoSrc}`);
        } else if (window.currentStage === 'stage4-3-1') {
            if (matchResult.level && highMatchLevels.includes(matchResult.level)) {
                videoSrc = 'assets/videos/phone_high.mp4';
            } else {
                videoSrc = 'assets/videos/phone_low.mp4';
            }
            console.log(`Stage 4-3-1 (Phone): Match level '${matchResult.level}', determined video: ${videoSrc}`);
        } else if (window.currentStage === 'stage4-4-1') {
            if (matchResult.level && highMatchLevels.includes(matchResult.level)) {
                videoSrc = 'assets/videos/camera_high.mp4';
            } else {
                videoSrc = 'assets/videos/camera_low.mp4';
            }
            console.log(`Stage 4-4-1 (Camera/Monitor): Match level '${matchResult.level}', determined video: ${videoSrc}`);
        }

        // Call the generalized function in index.html to handle video playback and transition
        if (typeof window.playFeedbackVideoAndReturnToStage === 'function') {
            // Add a delay before playing the video to allow user to see the match result
            setTimeout(() => {
                if (window.playFeedbackVideoAndReturnToStage) {
                    // Pass videoSrc, targetReturnStage ('stage2'), and currentActionStageId (window.currentStage)
                    window.playFeedbackVideoAndReturnToStage(videoSrc, 'stage2', window.currentStage);
                } else {
                    console.error('playFeedbackVideoAndReturnToStage function not found on window object during timeout execution.');
                    // Fallback if function is somehow still not available
                    console.log("Attempting fallback: Dispatching 'requestStageTransition' event directly.");
                    const fallbackDetail = { stage: 'stage2' };
                    if (window.currentStage.startsWith('stage4-')) { // Assuming stage 2 returns need 'arg: true'
                        fallbackDetail.arg = true;
                    }
                    document.dispatchEvent(new CustomEvent('requestStageTransition', { detail: fallbackDetail }));
                }
            }, 3000); // 3-second delay
        } else {
            console.error('Global video playback function (playFeedbackVideoAndReturnToStage) not found. Cannot play feedback video.');
            // If the global function isn't there, at least try to transition back to stage2 after a delay
            setTimeout(() => {
                const fallbackDetail = { stage: 'stage2' };
                if (window.currentStage.startsWith('stage4-')) { // Assuming stage 2 returns need 'arg: true'
                     fallbackDetail.arg = true;
                }
                document.dispatchEvent(new CustomEvent('requestStageTransition', { detail: fallbackDetail }));
            }, 3000);
        }
    }
}

// 初始化手势识别UI
function initGestureUI() {
    console.log('开始初始化手势识别UI');
    
    if (isGestureUIInitialized) {
        console.log('手势识别UI已经初始化过，跳过');
        return;
    }
    
    // 为stage4-1-1添加匹配度显示元素
    const stage4_1_1Container = document.getElementById('stage4-1-1-container');
    console.log('stage4-1-1-container 元素:', stage4_1_1Container);
    
    if (stage4_1_1Container) {
        if (!stage4_1_1Container.querySelector('.gesture-match-container')) {
            console.log('为 stage4-1-1-container 创建匹配度显示元素');
            
            const matchContainer = document.createElement('div');
            matchContainer.className = 'gesture-match-container';
            matchContainer.style.width = '80%';
            matchContainer.style.maxWidth = '500px';
            matchContainer.style.margin = '20px auto';
            matchContainer.style.padding = '10px';
            matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
            matchContainer.style.border = '1px solid #00ccff';
            matchContainer.style.borderRadius = '8px';
            matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
            
            matchContainer.innerHTML = `
                <div class="progress-container" style="margin: 10px 0;">
                    <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                        <div id="progressFill-stage4-1-1" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <div id="progressLabel-stage4-1-1" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
                </div>
            `;
            
            stage4_1_1Container.appendChild(matchContainer);
            console.log('匹配度显示元素已添加到 stage4-1-1-container');
        } else {
            console.log('stage4-1-1-container 已经存在匹配度显示元素');
        }
    } else {
        console.error('未找到 stage4-1-1-container 元素！');
        
        // 如果元素不存在，尝试创建它
        const stageElementsContainer = document.getElementById('stage-elements-container');
        if (stageElementsContainer) {
            console.log('尝试创建 stage4-1-1-container 元素');
            
            const newContainer = document.createElement('div');
            newContainer.id = 'stage4-1-1-container';
            newContainer.className = 'stage-message';
            newContainer.style.display = 'none';
            newContainer.style.flexDirection = 'column';
            newContainer.style.alignItems = 'center';
            newContainer.style.justifyContent = 'center';
            newContainer.style.textAlign = 'center';
            newContainer.style.height = '100%';
            
            const actionMessage = document.createElement('p');
            actionMessage.id = 'action-reproduction-message';
            actionMessage.textContent = 'Please reproduce the action';
            
            newContainer.appendChild(actionMessage);
            stageElementsContainer.appendChild(newContainer);
            
            console.log('stage4-1-1-container 元素已创建');
            
            // 再次尝试添加匹配度显示元素
            const matchContainer = document.createElement('div');
            matchContainer.className = 'gesture-match-container';
            matchContainer.style.width = '80%';
            matchContainer.style.maxWidth = '500px';
            matchContainer.style.margin = '20px auto';
            matchContainer.style.padding = '10px';
            matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
            matchContainer.style.border = '1px solid #00ccff';
            matchContainer.style.borderRadius = '8px';
            matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
            
            matchContainer.innerHTML = `
                <div class="progress-container" style="margin: 10px 0;">
                    <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                        <div id="progressFill-stage4-1-1" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <div id="progressLabel-stage4-1-1" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
                </div>
            `;
            
            newContainer.appendChild(matchContainer);
            console.log('匹配度显示元素已添加到新创建的 stage4-1-1-container');
        } else {
            console.error('未找到 stage-elements-container 元素，无法创建 UI 元素！');
        }
    }
    
    // 为其他stage4-x-1添加类似的匹配度显示元素
    ['stage4-2-1', 'stage4-3-1', 'stage4-4-1'].forEach(stageId => {
        const stageContainer = document.getElementById(`${stageId}-container`);
        console.log(`${stageId}-container 元素:`, stageContainer);
        
        if (stageContainer && !stageContainer.querySelector('.gesture-match-container')) {
            console.log(`为 ${stageId}-container 创建匹配度显示元素`);
            
            const matchContainer = document.createElement('div');
            matchContainer.className = 'gesture-match-container';
            matchContainer.style.width = '80%';
            matchContainer.style.maxWidth = '500px';
            matchContainer.style.margin = '20px auto';
            matchContainer.style.padding = '10px';
            matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
            matchContainer.style.border = '1px solid #00ccff';
            matchContainer.style.borderRadius = '8px';
            matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
            
            matchContainer.innerHTML = `
                <div class="progress-container" style="margin: 10px 0;">
                    <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                        <div id="progressFill-${stageId}" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <div id="progressLabel-${stageId}" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
                </div>
            `;
            
            stageContainer.appendChild(matchContainer);
            console.log(`匹配度显示元素已添加到 ${stageId}-container`);
        }
    });
    
    // 创建手势匹配度显示元素
    const stages = ['stage4-1-1', 'stage4-2-1', 'stage4-3-1', 'stage4-4-1'];
    
    for (const stage of stages) {
        const container = document.getElementById(`${stage}-container`);
        if (!container) {
            console.warn(`未找到 ${stage}-container 元素，无法初始化手势识别UI`);
            continue;
        }
        
        // 检查是否已经创建了匹配度显示元素
        if (container.querySelector('.gesture-match-container')) {
            console.log(`${stage} 匹配度显示元素已存在`);
            continue;
        }
        
        // 创建匹配度显示元素
        const matchContainer = document.createElement('div');
        matchContainer.className = 'gesture-match-container';
        matchContainer.style.width = '80%';
        matchContainer.style.maxWidth = '500px';
        matchContainer.style.margin = '20px auto';
        matchContainer.style.padding = '10px';
        matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
        matchContainer.style.border = '1px solid #00ccff';
        matchContainer.style.borderRadius = '8px';
        matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
        
        matchContainer.innerHTML = `
            <div class="progress-container" style="margin: 10px 0;">
                <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                    <div id="progressFill-${stage}" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                </div>
                <div id="progressLabel-${stage}" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
            </div>
        `;
        
        container.appendChild(matchContainer);
        console.log(`为 ${stage} 创建了手势匹配度显示元素`);
    }
    
    // 添加全局MPU数据处理函数
    window.processMPUDataFromESP32 = function(data) {
        console.log('全局MPU数据处理函数被调用:', data);
        
        // 如果是字符串类型的MPU数据，则处理它
        if (data && data.type === 'mpu_string' && data.payload && typeof data.payload === 'string' && data.payload.includes('ax:')) {
            // 直接调用全局处理函数
            window.processMPUData(data.payload);
        }
    };
    
    isGestureUIInitialized = true;
    console.log('手势识别UI初始化完成');
}

// 事件监听器
document.addEventListener('DOMContentLoaded', async () => {
    console.log('手势识别模块初始化...');
    
    // 初始化UI元素
    initGestureUI();
    
    // 仅使用HTML中已经初始化的ESP32连接
    if (window.esp32Connection) {
        console.log('使用HTML中已初始化的ESP32连接对象');
        esp32Connection = window.esp32Connection;
        
        // 添加数据监听器
        esp32Connection.onData((data) => {
            console.log('从 ESP32 接收到数据:', data);
            if (data.type === 'mpu' || data.type === 'mpu_string') {
                processMPUData(data.payload);
            }
        });
    } else {
        console.warn('HTML中没有初始化ESP32连接，手势识别功能可能无法正常工作');
    }
    
    // 处理从MPU6050接收到的数据
    function processMPUData(payload) {
        // 如果不在记录状态，直接返回
        if (!isRecording) return;
        
        // 确保当前阶段已设置
        if (!window.currentStage) {
            // 尝试从URL或当前显示的容器推断当前阶段
            const containers = [
                'stage4-1-1-container',
                'stage4-2-1-container',
                'stage4-3-1-container',
                'stage4-4-1-container'
            ];
            
            for (const id of containers) {
                const container = document.getElementById(id);
                if (container && container.style.display !== 'none') {
                    window.currentStage = id.replace('-container', '');
                    console.log(`从容器推断当前阶段: ${window.currentStage}`);
                    break;
                }
            }
            
            // 如果仍然无法确定阶段，默认为stage4-1-1
            if (!window.currentStage) {
                window.currentStage = 'stage4-1-1';
                console.log('无法确定当前阶段，默认设置为stage4-1-1');
            }
        }
        
        // 解析MPU数据
        let mpuData;
        
        if (typeof payload === 'string') {
            // 解析字符串格式的MPU数据，例如 'ax:10.01,ay:-0.69,az:3.05,gx:-0.44,gy:0.33,gz:-0.94'
            try {
                const parts = payload.split(',');
                const values = {};
                
                for (const part of parts) {
                    const [key, value] = part.split(':');
                    values[key] = parseFloat(value);
                }
                
                mpuData = {
                    accel: {
                        x: values.ax || 0,
                        y: values.ay || 0,
                        z: values.az || 0
                    },
                    gyro: {
                        x: values.gx || 0,
                        y: values.gy || 0,
                        z: values.gz || 0
                    },
                    timestamp: Date.now()
                };
            } catch (error) {
                console.error('解析MPU数据字符串时出错:', error, payload);
                return;
            }
        } else if (typeof payload === 'object') {
            // 如果已经是对象格式
            mpuData = {
                accel: {
                    x: payload.ax || payload.accel?.x || 0,
                    y: payload.ay || payload.accel?.y || 0,
                    z: payload.az || payload.accel?.z || 0
                },
                gyro: {
                    x: payload.gx || payload.gyro?.x || 0,
                    y: payload.gy || payload.gyro?.y || 0,
                    z: payload.gz || payload.gyro?.z || 0
                },
                timestamp: Date.now()
            };
        } else {
            console.error('无法识别的MPU数据格式:', payload);
            return;
        }
        
        // 将数据添加到当前数据数组
        currentData.push(mpuData);
        
        // 如果收集了足够的数据点，自动停止记录
        if (currentData.length >= 100) {
            console.log(`已收集${currentData.length}个数据点，自动停止记录`);
            finishRecording();
        }
    }
    
    // 监听 stage 变化
    document.addEventListener('stageChange', (event) => {
        const newStage = event.detail.stage;
        console.log(`Stage 变化: ${newStage}`);
        
        // 更新全局当前阶段变量
        window.currentStage = newStage;
        
        // 在 action reproduction 阶段自动开始记录
        if (newStage === 'stage4-1-1' || 
            newStage === 'stage4-2-1' || 
            newStage === 'stage4-3-1' || 
            newStage === 'stage4-4-1') {
            
            // 设置当前动作类型
            if (newStage === 'stage4-1-1') currentActionType = 'cup';
            else if (newStage === 'stage4-2-1') currentActionType = 'knife';
            else if (newStage === 'stage4-3-1') currentActionType = 'phone';
            else if (newStage === 'stage4-4-1') currentActionType = 'monitor';
            
            console.log(`开始记录 ${currentActionType} 动作数据...`);
            
            // 清空当前数据并开始记录
            currentData = [];
            isRecording = true;
            
            // 重置匹配度显示
            const progressFill = document.getElementById(`progressFill-${newStage}`);
            const progressLabel = document.getElementById(`progressLabel-${newStage}`);
            
            if (progressFill) {
                progressFill.style.width = '0%';
                console.log(`重置 ${newStage} 进度条`);
            } else {
                console.warn(`未找到 ${newStage} 进度条元素`);
                // 尝试再次初始化 UI
                initGestureUI();
            }
            
            if (progressLabel) {
                progressLabel.textContent = 'Match: 0%';
            }
            
            // 手动触发一次 UI 更新，确保元素可见但隐藏匹配度容器
            const container = document.getElementById(`${newStage}-container`);
            if (container) {
                // 获取匹配度显示元素，并设置为隐藏
                const matchContainer = container.querySelector('.gesture-match-container');
                if (matchContainer) {
                    matchContainer.style.display = 'none';
                    console.log(`${newStage} 匹配度显示元素已设置为隐藏`);
                } else {
                    console.warn(`${newStage} 匹配度显示元素不存在，尝试重新创建`);
                    // 尝试为当前阶段创建匹配度显示元素
                    const newMatchContainer = document.createElement('div');
                    newMatchContainer.className = 'gesture-match-container';
                    newMatchContainer.style.width = '80%';
                    newMatchContainer.style.maxWidth = '500px';
                    newMatchContainer.style.margin = '20px auto';
                    newMatchContainer.style.padding = '10px';
                    newMatchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
                    newMatchContainer.style.border = '1px solid #00ccff';
                    newMatchContainer.style.borderRadius = '8px';
                    newMatchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
                    newMatchContainer.style.display = 'none'; // 初始状态为隐藏
                    
                    newMatchContainer.innerHTML = `
                        <div class="progress-container" style="margin: 10px 0;">
                            <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                                <div id="progressFill-${newStage}" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                            </div>
                            <div id="progressLabel-${newStage}" class="progress-label" style="margin-top: 5px; font-size: 0.8em; color: #00ccff; text-align: center; font-family: 'Arial', sans-serif;">Match: 0%</div>
                        </div>
                    `;
                    
                    container.appendChild(newMatchContainer);
                    console.log(`为 ${newStage} 创建了新的匹配度显示元素`);
                }
            } else {
                console.error(`未找到 ${newStage}-container 元素！`);
            }
        } else {
            // 在其他阶段停止记录
            isRecording = false;
        }
    });
    
    // 手动触发一次 stageChange 事件，如果当前已经在 stage4-1-1 阶段
    if (window.currentStage === 'stage4-1-1') {
        console.log('当前已经在 stage4-1-1 阶段，手动触发 stageChange 事件');
        const stageChangeEvent = new CustomEvent('stageChange', { 
            detail: { stage: 'stage4-1-1', actionType: 'cup' } 
        });
        document.dispatchEvent(stageChangeEvent);
    }
});

// 暴露给全局的API
window.GestureRecognition = {
    startRecording: function(actionType) {
        currentActionType = actionType || 'cup';
        currentData = [];
        isRecording = true;
        console.log(`手动开始记录${currentActionType}动作...`);
        return true;
    },
    
    stopRecording: function() {
        if (!isRecording) return false;
        finishRecording();
        return matchResult;
    },
    
    getLastMatchResult: function() {
        return matchResult;
    },
    
    setActionType: function(actionType) {
        if (['cup', 'knife', 'phone', 'monitor'].includes(actionType)) {
            currentActionType = actionType;
            return true;
        }
        return false;
    }
};