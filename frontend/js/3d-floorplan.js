/**
 * 3D户型图渲染器 - 使用 Three.js 创建真实3D户型图
 * 包含客厅和厨房布局
 */

class FloorplanRenderer3D {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.isInitialized = false;
    this.isAnimating = false;
    this.animationId = null;
    this.objects = {};
    this.lights = {};
    this.materials = {};
    this.textures = {};
  }

  // 检查WebGL支持
  _checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      return !!window.WebGLRenderingContext && 
             (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
      return false;
    }
  }

  // 初始化渲染器
  init() {
    if (this.isInitialized) return;

    // 检查WebGL支持
    if (!this._checkWebGLSupport()) {
      console.error('WebGL不受支持或被禁用，无法初始化渲染器');
      return;
    }

    const canvas = document.getElementById(this.canvasId);
    if (!canvas) {
      console.error(`找不到ID为 ${this.canvasId} 的canvas元素`);
      return;
    }

    try {
      // 创建场景 - 使用深蓝色背景而不是纯黑色
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x000a1f);
      this.scene.fog = new THREE.Fog(0x000a1f, 10, 30);

      // 创建相机
      const aspect = canvas.clientWidth / canvas.clientHeight || 1; // 防止除以0
      this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
      this.camera.position.set(0, 15, 15);
      this.camera.lookAt(0, 0, 0);

      // 创建渲染器，添加错误处理
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false // 允许在性能受限的情况下也创建上下文
        });
      } catch (error) {
        console.error('WebGL渲染器创建失败:', error);
        // 尝试使用基本设置重新创建
        try {
          this.renderer = new THREE.WebGLRenderer({ canvas: canvas });
        } catch (fallbackError) {
          console.error('基本渲染器创建也失败:', fallbackError);
          return; // 如果仍然失败，直接返回
        }
      }
      
      // 确保使用容器的实际尺寸
      const container = canvas.parentElement;
      const containerWidth = container ? container.clientWidth : window.innerWidth;
      const containerHeight = container ? container.clientHeight : window.innerHeight;
      
      console.log('初始化时容器尺寸:', containerWidth, containerHeight);
      
      this.renderer.setSize(containerWidth, containerHeight, false);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 限制像素比以提高性能
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // 添加光源
      this.setupLights();

      // 创建材质
      this.createMaterials();

      // 添加窗口大小变化监听
      window.addEventListener('resize', this.onWindowResize.bind(this));

      this.isInitialized = true;
      console.log('3D户型图渲染器初始化完成');
    } catch (error) {
      console.error('3D户型图渲染器初始化失败:', error);
    }
  }

  // 设置光源
  setupLights() {
    // 环境光 - 更亮的蓝色调
    const ambientLight = new THREE.AmbientLight(0x3388ff, 0.8);
    this.scene.add(ambientLight);
    this.lights.ambient = ambientLight;

    // 主方向光 - 白色调，增强强度
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -10;
    mainLight.shadow.camera.right = 10;
    mainLight.shadow.camera.top = 10;
    mainLight.shadow.camera.bottom = -10;
    this.scene.add(mainLight);
    this.lights.main = mainLight;

    // 点光源 - 主蓝色光，更亮更鲜艳
    const blueLight = new THREE.PointLight(0x44aaff, 1.5, 25);
    blueLight.position.set(0, 8, 0);
    blueLight.castShadow = true;
    this.scene.add(blueLight);
    this.lights.blue = blueLight;

    // 点光源 - 客厅，更亮的蓝色
    const livingRoomLight = new THREE.PointLight(0x55aaff, 1.0, 12);
    livingRoomLight.position.set(3, 3, 3);
    livingRoomLight.castShadow = true;
    this.scene.add(livingRoomLight);
    this.lights.livingRoom = livingRoomLight;

    // 点光源 - 厨房，更亮的蓝色
    const kitchenLight = new THREE.PointLight(0x55aaff, 1.0, 12);
    kitchenLight.position.set(-3, 3, -3);
    kitchenLight.castShadow = true;
    this.scene.add(kitchenLight);
    this.lights.kitchen = kitchenLight;
  }

  // 创建材质
  createMaterials() {
    // 地板材质 - 更亮的蓝色
    this.materials.floor = new THREE.MeshStandardMaterial({
      color: 0x002255,  // 更亮的深蓝色
      roughness: 0.7,
      metalness: 0.5,
      emissive: 0x0055cc,  // 更亮的蓝色发光
      emissiveIntensity: 0.3
    });

    // 墙壁材质 - 更亮的蓝色
    this.materials.wall = new THREE.MeshStandardMaterial({
      color: 0x0033aa,  // 更亮的深蓝色
      roughness: 0.6,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
      emissive: 0x0088ff,  // 更亮的蓝色发光
      emissiveIntensity: 0.35
    });

    // 发光材质 - 用于边缘高亮，更亮更鲜艳
    this.materials.glow = new THREE.MeshBasicMaterial({
      color: 0x44aaff,  // 更亮更鲜艳的蓝色
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    // 家具材质 - 更亮的蓝色
    this.materials.furniture = new THREE.MeshStandardMaterial({
      color: 0x0055cc,  // 更亮的蓝色
      roughness: 0.4,
      metalness: 0.7,
      emissive: 0x0088dd,  // 更亮的蓝色发光
      emissiveIntensity: 0.4
    });

    // 线框材质
    this.materials.wireframe = new THREE.LineBasicMaterial({
      color: 0x0066ff,  // 纯亮蓝色
      transparent: true,
      opacity: 0.9
    });
  }

  // 创建户型图
  createFloorplan() {
    // 创建地板
    this.createFloor();
    
    // 创建墙壁
    this.createWalls();
    
    // 创建家具
    this.createFurniture();
    
    // 创建装饰物
    this.createDecorations();
    
    console.log('3D户型图创建完成');
  }

  // 创建地板
  createFloor() {
    const floorGeometry = new THREE.PlaneGeometry(12, 12);
    const floor = new THREE.Mesh(floorGeometry, this.materials.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    
    // 添加网格线
    const gridHelper = new THREE.GridHelper(12, 12, 0x00ffff, 0x004444);
    gridHelper.position.y = 0.01;
    
    // 添加地板边缘发光效果
    const edgeGeometry = new THREE.EdgesGeometry(floorGeometry);
    const edges = new THREE.LineSegments(edgeGeometry, this.materials.wireframe);
    edges.rotation.x = -Math.PI / 2;
    edges.position.y = 0.01;
    
    this.scene.add(floor);
    this.scene.add(gridHelper);
    this.scene.add(edges);
    
    this.objects.floor = floor;
  }

  // 创建墙壁
  createWalls() {
    // 创建墙壁组
    const wallsGroup = new THREE.Group();
    
    // 墙壁高度
    const wallHeight = 3;
    
    // 墙壁厚度
    const wallThickness = 0.15;  // 减小墙壁厚度以减少空间占用
    
    // 创建外墙 - 调整外墙尺寸以确保内部空间更大
    // 后墙
    const backWallGeometry = new THREE.BoxGeometry(12, wallHeight, wallThickness);
    const backWall = new THREE.Mesh(backWallGeometry, this.materials.wall);
    backWall.position.set(0, wallHeight/2, -6 + wallThickness/2);  // 将墙壁向内移动半个厚度
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    wallsGroup.add(backWall);
    
    // 左墙
    const leftWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, 12);
    const leftWall = new THREE.Mesh(leftWallGeometry, this.materials.wall);
    leftWall.position.set(-6 + wallThickness/2, wallHeight/2, 0);  // 将墙壁向内移动半个厚度
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    wallsGroup.add(leftWall);
    
    // 右墙 (部分)
    const rightWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, 8);
    const rightWall = new THREE.Mesh(rightWallGeometry, this.materials.wall);
    rightWall.position.set(6 - wallThickness/2, wallHeight/2, -2);  // 将墙壁向内移动半个厚度
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    wallsGroup.add(rightWall);
    
    // 前墙 (部分)
    const frontWallGeometry = new THREE.BoxGeometry(8, wallHeight, wallThickness);
    const frontWall = new THREE.Mesh(frontWallGeometry, this.materials.wall);
    frontWall.position.set(-2, wallHeight/2, 6 - wallThickness/2);  // 将墙壁向内移动半个厚度
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    wallsGroup.add(frontWall);
    
    // 分隔墙 (厨房和客厅之间)
    const dividerWallGeometry = new THREE.BoxGeometry(6, wallHeight, wallThickness);
    const dividerWall = new THREE.Mesh(dividerWallGeometry, this.materials.wall);
    dividerWall.position.set(-3, wallHeight/2, 0);
    dividerWall.castShadow = true;
    dividerWall.receiveShadow = true;
    wallsGroup.add(dividerWall);
    
    // 为所有墙壁添加发光边缘
    wallsGroup.children.forEach(wall => {
      const edgeGeometry = new THREE.EdgesGeometry(wall.geometry);
      const edges = new THREE.LineSegments(edgeGeometry, this.materials.wireframe);
      edges.position.copy(wall.position);
      edges.rotation.copy(wall.rotation);
      wallsGroup.add(edges);
    });
    
    this.scene.add(wallsGroup);
    this.objects.walls = wallsGroup;
  }

  // 创建家具
  createFurniture() {
    // 创建家具组
    const furnitureGroup = new THREE.Group();
    
    // 墙壁厚度参考值，用于计算家具位置
    const wallThickness = 0.15;
    const wallOffset = 0.3; // 与墙壁保持的距离
    
    // 客厅家具
    
    // 沙发
    const sofaGeometry = new THREE.BoxGeometry(4, 1, 1.5);
    const sofa = new THREE.Mesh(sofaGeometry, this.materials.furniture);
    sofa.position.set(2, 0.5, 6 - wallThickness - wallOffset - sofaGeometry.parameters.depth/2);
    sofa.castShadow = true;
    sofa.receiveShadow = true;
    furnitureGroup.add(sofa);
    
    // 茶几
    const tableGeometry = new THREE.BoxGeometry(2, 0.5, 1);
    const table = new THREE.Mesh(tableGeometry, this.materials.furniture);
    table.position.set(2, 0.25, 3);
    table.castShadow = true;
    table.receiveShadow = true;
    furnitureGroup.add(table);
    
    // 电视柜
    const tvStandGeometry = new THREE.BoxGeometry(3, 0.8, 1);
    const tvStand = new THREE.Mesh(tvStandGeometry, this.materials.furniture);
    tvStand.position.set(2, 0.4, -6 + wallThickness + wallOffset + tvStandGeometry.parameters.depth/2);
    tvStand.castShadow = true;
    tvStand.receiveShadow = true;
    furnitureGroup.add(tvStand);
    
    // 电视
    const tvGeometry = new THREE.BoxGeometry(2.5, 1.5, 0.2);
    const tv = new THREE.Mesh(tvGeometry, this.materials.furniture);
    tv.position.set(2, 1.55, tvStand.position.z - tvStandGeometry.parameters.depth/2 - tvGeometry.parameters.depth/2 - 0.05);
    tv.castShadow = true;
    tv.receiveShadow = true;
    furnitureGroup.add(tv);
    
    // 厨房家具
    
    // 厨柜
    const kitchenCounterGeometry = new THREE.BoxGeometry(5, 1, 1);
    const kitchenCounter = new THREE.Mesh(kitchenCounterGeometry, this.materials.furniture);
    kitchenCounter.position.set(-3.5, 0.5, -6 + wallThickness + wallOffset + kitchenCounterGeometry.parameters.depth/2);
    kitchenCounter.castShadow = true;
    kitchenCounter.receiveShadow = true;
    furnitureGroup.add(kitchenCounter);
    
    // 冰箱
    const fridgeGeometry = new THREE.BoxGeometry(1, 2, 1);
    const fridge = new THREE.Mesh(fridgeGeometry, this.materials.furniture);
    fridge.position.set(-6 + wallThickness + wallOffset + fridgeGeometry.parameters.width/2, 1, -4);
    fridge.castShadow = true;
    fridge.receiveShadow = true;
    furnitureGroup.add(fridge);
    
    // 厨房岛台
    const islandGeometry = new THREE.BoxGeometry(2, 1, 3);
    const island = new THREE.Mesh(islandGeometry, this.materials.furniture);
    island.position.set(-3, 0.5, -1.5);
    island.castShadow = true;
    island.receiveShadow = true;
    furnitureGroup.add(island);
    
    // 为所有家具添加发光边缘
    furnitureGroup.children.forEach(furniture => {
      const edgeGeometry = new THREE.EdgesGeometry(furniture.geometry);
      const edges = new THREE.LineSegments(edgeGeometry, this.materials.wireframe);
      edges.position.copy(furniture.position);
      edges.rotation.copy(furniture.rotation);
      furnitureGroup.add(edges);
    });
    
    this.scene.add(furnitureGroup);
    this.objects.furniture = furnitureGroup;
  }

  // 创建装饰物
  createDecorations() {
    // 创建装饰物组
    const decorGroup = new THREE.Group();
    
    // 添加全息投影底座
    const hologramGeometry = new THREE.BoxGeometry(12.5, 0.05, 12.5);
    const hologramMaterial = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.15,
      wireframe: true
    });
    
    const hologram = new THREE.Mesh(hologramGeometry, hologramMaterial);
    hologram.position.y = -0.025;
    decorGroup.add(hologram);
    
    // 移除了四个角落的光柱
    
    // 添加房间标签 - 客厅
    const livingRoomMarker = this.createRoomMarker("LIVING ROOM");
    livingRoomMarker.position.set(2, 0.1, 2);
    decorGroup.add(livingRoomMarker);
    
    // 添加房间标签 - 厨房
    const kitchenMarker = this.createRoomMarker("KITCHEN");
    kitchenMarker.position.set(-3, 0.1, -3);
    decorGroup.add(kitchenMarker);
    
    // 添加案件标记
    const crimeMarker = this.createRoomMarker("CRIME SCENE");
    crimeMarker.position.set(0, 0.1, 0);
    crimeMarker.scale.set(1.5, 1.5, 1.5);
    decorGroup.add(crimeMarker);
    
    // 添加证据点标记
    this.createEvidenceMarkers();
    
    this.scene.add(decorGroup);
    this.objects.decorations = decorGroup;
  }
  
  // 创建证据点标记
  createEvidenceMarkers() {
    // 创建证据点组
    const evidenceGroup = new THREE.Group();
    
    // 创建红色标记点材质
    const redMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      emissive: 0xff5555,
      emissiveIntensity: 1.2
    });
    
    // 创建标记点几何体
    const markerGeometry = new THREE.SphereGeometry(0.25, 16, 16);
    
    // 添加茶几上的证据点
    const tableMarker = new THREE.Mesh(markerGeometry, redMarkerMaterial);
    // 使用已存在的茶几位置，并稍微向上偏移
    if (this.objects.furniture) {
      const table = this.objects.furniture.children.find(child => 
        child.geometry && child.geometry.parameters && 
        child.geometry.parameters.width === 2 && 
        child.geometry.parameters.height === 0.5);
      
      if (table) {
        tableMarker.position.set(
          table.position.x + 0.5, // 偏移到茶几的右侧
          table.position.y + 0.3, // 置于茶几上方
          table.position.z
        );
        evidenceGroup.add(tableMarker);
      }
    }
    
    // 添加沙发上的证据点
    const sofaMarker = new THREE.Mesh(markerGeometry, redMarkerMaterial);
    if (this.objects.furniture) {
      const sofa = this.objects.furniture.children.find(child => 
        child.geometry && child.geometry.parameters && 
        child.geometry.parameters.width === 4 && 
        child.geometry.parameters.depth === 1.5);
      
      if (sofa) {
        sofaMarker.position.set(
          sofa.position.x - 1, // 偏移到沙发的左侧
          sofa.position.y + 0.6, // 置于沙发上方
          sofa.position.z
        );
        evidenceGroup.add(sofaMarker);
      }
    }
    
    // 添加厨房岛台上的证据点
    const islandMarker = new THREE.Mesh(markerGeometry, redMarkerMaterial);
    if (this.objects.furniture) {
      const island = this.objects.furniture.children.find(child => 
        child.geometry && child.geometry.parameters && 
        child.geometry.parameters.width === 2 && 
        child.geometry.parameters.depth === 3);
      
      if (island) {
        islandMarker.position.set(
          island.position.x, 
          island.position.y + 0.6, // 置于岛台上方
          island.position.z - 1 // 偏移到岛台的前方
        );
        evidenceGroup.add(islandMarker);
      }
    }
    
    // 添加地面上的证据点
    const floorMarker = new THREE.Mesh(markerGeometry, redMarkerMaterial);
    floorMarker.position.set(-2, 0.15, 4); // 客厅和厨房之间的地面上
    evidenceGroup.add(floorMarker);
    
    // 添加脉冲动画效果
    this.evidenceMarkers = evidenceGroup.children;
    
    // 将证据点组添加到场景
    this.scene.add(evidenceGroup);
    this.objects.evidenceMarkers = evidenceGroup;
  }
  
  // 创建房间标记
  createRoomMarker(text) {
    const group = new THREE.Group();
    
    // 创建圆形底座
    const baseGeometry = new THREE.CircleGeometry(0.4, 32);
    const baseMaterial = new THREE.MeshBasicMaterial({
      color: 0x55aaff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.01;
    group.add(base);
    
    // 创建文本标签（这里只是用一个平面代替，实际应该使用TextGeometry）
    const labelGeometry = new THREE.PlaneGeometry(0.8, 0.2);
    const labelMaterial = new THREE.MeshBasicMaterial({
      color: 0x55aaff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.02;
    group.add(label);
    
    return group;
  }

  // 开始渲染动画
  startAnimation() {
    if (!this.isInitialized) {
      console.error('3D户型图渲染器尚未初始化');
      return;
    }

    this.isAnimating = true;
    this.animate();
    console.log('3D户型图动画开始');
  }

  // 停止渲染动画
  stopAnimation() {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    console.log('3D户型图动画停止');
  }

  // 动画循环
  animate() {
    if (!this.isAnimating) return;

    // 旋转相机
    const time = Date.now() * 0.0001;
    const radius = 15;
    this.camera.position.x = Math.sin(time) * radius;
    this.camera.position.z = Math.cos(time) * radius;
    this.camera.lookAt(0, 0, 0);
    
    // 更新光源
    if (this.lights.blue) {
      this.lights.blue.intensity = 0.8 + Math.sin(time * 2) * 0.2;
    }
    
    // 更新装饰物
    if (this.objects.decorations) {
      this.objects.decorations.children.forEach(decor => {
        if (decor.children && decor.children.length > 0) {
          // 房间标记的浮动效果
          decor.position.y = 0.1 + Math.sin(time * 2 + decor.position.x) * 0.05;
        }
      });
    }
    
    // 更新证据点的脉冲动画
    if (this.evidenceMarkers && this.evidenceMarkers.length > 0) {
      this.evidenceMarkers.forEach((marker, index) => {
        // 为每个标记设置不同的脉冲频率
        const pulseSpeed = 3 + index * 0.5;
        const pulseScale = 0.8 + Math.sin(time * pulseSpeed) * 0.2;
        
        // 脉冲缩放效果
        marker.scale.set(pulseScale, pulseScale, pulseScale);
      });
    }

    // 直接渲染场景，而不是调用render函数
    if (this.renderer && this.scene && this.camera) {
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (error) {
        console.error('动画渲染时发生错误:', error);
      }
    }

    // 继续动画循环
    this.animationId = requestAnimationFrame(this.animate.bind(this));
  }

  // 渲染场景
  render() {
    if (!this.isInitialized) return;
    
    if (!this.objects.floor) {
      this.createFloorplan();
    }
    
    // 如果渲染器、场景和相机都准备好了，才渲染
    if (this.renderer && this.scene && this.camera) {
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (error) {
        console.error('渲染时发生错误:', error);
      }
    }
  }
  
  // 窗口大小变化处理
  onWindowResize() {
    // 防止在渲染器未初始化时调用
    if (!this.renderer || !this.scene || !this.camera) {
      console.warn('渲染器、场景或相机未准备好，跳过窗口大小调整');
      return;
    }
    
    try {
      const canvas = this.renderer.domElement;
      if (!canvas) {
        console.warn('渲染器DOM元素不存在，跳过窗口大小调整');
        return;
      }
      
      const container = canvas.parentElement;
      
      // 使用容器的实际尺寸，而不是canvas的尺寸
      const containerWidth = container ? container.clientWidth : window.innerWidth;
      const containerHeight = container ? container.clientHeight : window.innerHeight;
      
      // 设置渲染器尺寸为容器尺寸
      this.renderer.setSize(containerWidth, containerHeight, false);
      this.renderer.setViewport(0, 0, containerWidth, containerHeight);
      
      // 更新相机宽高比
      this.camera.aspect = containerWidth / containerHeight;
      this.camera.updateProjectionMatrix();
    } catch (error) {
      console.error('窗口大小调整时发生错误:', error);
    }
  }

  // 隐藏户型图
  hide() {
    this.stopAnimation();
  }
  
  // 显示户型图
  show() {
    if (!this.isInitialized) {
      this.init();
    }
    
    if (!this.objects.floor) {
      this.createFloorplan();
    }
    
    // 开始动画
    this.startAnimation();
    
    // 渲染一帧
    if (this.renderer && this.scene && this.camera) {
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (error) {
        console.error('渲染时发生错误:', error);
      }
    }
    
    console.log('3D户型图显示完成');
  }
  
  // 缩放到茶几上的红点证据
  zoomToCoffeeTableEvidence() {
    console.log('缩放到茶几上的红点证据');
    
    // 停止环绕动画
    this.stopAnimation();
    
    // 确保渲染器大小正确
    this.onWindowResize();
    
    // 获取茶几的引用 - 使用几何体参数来识别
    let coffeeTable = null;
    if (this.objects.furniture) {
      // 遍历家具寻找茶几（宽度为2，高度为0.5的盒子）
      coffeeTable = this.objects.furniture.children.find(child => 
        child.geometry && child.geometry.parameters && 
        child.geometry.parameters.width === 2 && 
        child.geometry.parameters.height === 0.5);
      
      if (coffeeTable) {
        console.log('找到茶几:', coffeeTable.position);
      } else {
        console.log('未找到茶几，使用默认位置');
      }
    }
    
    // 记录原始相机位置
    const originalPosition = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z
    };
    
    // 记录原始相机目标点
    const originalTarget = new THREE.Vector3();
    this.camera.getWorldDirection(originalTarget);
    originalTarget.multiplyScalar(10).add(this.camera.position);
    
    // 确定目标位置
    let targetPosition, targetLookAt;
    
    // 如果还是找不到茶几，尝试使用红点的位置
    if (!coffeeTable && this.evidenceMarkers && this.evidenceMarkers.length > 0) {
      // 假设第一个红点在茶几上
      const tableMarker = this.evidenceMarkers[0];
      console.log('使用红点位置:', tableMarker.position);
      
      // 设置茶几位置为红点位置，但稍微调整y值
      const tablePosition = {
        x: tableMarker.position.x,
        y: tableMarker.position.y - 0.3, // 红点在茶几上方0.3单位
        z: tableMarker.position.z
      };
      
      // 设置目标相机位置和视点
      targetPosition = {
        x: tablePosition.x + 1,
        y: tablePosition.y + 1.5,
        z: tablePosition.z + 1.5
      };
      
      targetLookAt = {
        x: tablePosition.x,
        y: tablePosition.y,
        z: tablePosition.z
      };
      
    } else if (coffeeTable) {
      // 如果找到了茶几，使用茶几位置
      targetPosition = {
        x: coffeeTable.position.x + 1,
        y: coffeeTable.position.y + 1.5,
        z: coffeeTable.position.z + 1.5
      };
      
      targetLookAt = {
        x: coffeeTable.position.x,
        y: coffeeTable.position.y,
        z: coffeeTable.position.z
      };
      
    } else {
      // 如果什么都找不到，使用默认位置
      targetPosition = {
        x: 3,
        y: 2,
        z: 4.5
      };
      
      targetLookAt = {
        x: 2,
        y: 0.25,
        z: 3
      };
    }
    
    // 创建平滑缩放动画
    const duration = 3000; // 动画时间（毫秒），设置为30秒使动画更缓慢
    const startTime = Date.now();
    
    // 创建临时相机和目标点对象，用于插值计算
    const tempCameraPos = new THREE.Vector3();
    const tempLookAt = new THREE.Vector3();
    
    const animateZoom = () => {
      const elapsedTime = Date.now() - startTime;
      const progress = Math.min(elapsedTime / duration, 1);
      
      // 使用缓动函数使动画更自然
      const easeProgress = this._easeInOutCubic(progress);
      
      // 插值计算相机位置
      tempCameraPos.set(
        originalPosition.x + (targetPosition.x - originalPosition.x) * easeProgress,
        originalPosition.y + (targetPosition.y - originalPosition.y) * easeProgress,
        originalPosition.z + (targetPosition.z - originalPosition.z) * easeProgress
      );
      
      // 插值计算目标点
      tempLookAt.set(
        originalTarget.x + (targetLookAt.x - originalTarget.x) * easeProgress,
        originalTarget.y + (targetLookAt.y - originalTarget.y) * easeProgress,
        originalTarget.z + (targetLookAt.z - originalTarget.z) * easeProgress
      );
      
      // 更新相机位置和视点
      this.camera.position.copy(tempCameraPos);
      this.camera.lookAt(tempLookAt);
      
      // 更新相机
      this.camera.updateProjectionMatrix();
      
      // 渲染当前帧
      this.render();
      
      // 输出调试信息
      if (progress === 0 || progress === 1 || Math.round(progress * 10) % 2 === 0) {
        console.log(`动画进度: ${Math.round(progress * 100)}%, 相机位置:`, 
          this.camera.position.x.toFixed(2), 
          this.camera.position.y.toFixed(2), 
          this.camera.position.z.toFixed(2));
      }
      
      // 如果动画未完成，继续下一帧
      if (progress < 1) {
        requestAnimationFrame(animateZoom);
      } else {
        console.log('缩放动画完成!');
      }
    };
    
    // 开始缩放动画
    animateZoom();
    
    // 更新相机
    this.camera.updateProjectionMatrix();
    
    // 确保渲染器尺寸和视口正确
    const canvas = this.renderer.domElement;
    const container = canvas.parentElement;
    
    // 获取容器的实际尺寸
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    console.log('容器尺寸:', containerWidth, containerHeight);
    
    // 设置渲染器尺寸为容器尺寸
    this.renderer.setSize(containerWidth, containerHeight, false);
    this.renderer.setViewport(0, 0, containerWidth, containerHeight);
    
    // 渲染场景
    this.renderer.render(this.scene, this.camera);
    
    console.log('已完成相机定位到茶几位置');
  }

  // 缓动函数，使动画更自然
  _easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // 清理资源
  dispose() {
    this.stopAnimation();
    
    // 清理场景中的所有对象
    if (this.scene) {
      this.scene.traverse(object => {
        if (object.geometry) {
          object.geometry.dispose();
        }
        
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    }
    
    // 清理渲染器
    if (this.renderer) {
      this.renderer.dispose();
    }
    
    // 清理纹理
    Object.values(this.textures).forEach(texture => {
      if (texture) texture.dispose();
    });
    
    this.isInitialized = false;
    console.log('3D户型图渲染器资源已清理');
  }
}

// 将类添加到全局作用域
window.FloorplanRenderer3D = FloorplanRenderer3D;
