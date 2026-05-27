# Модели — «Дорога для машинки»

## Машины (экран выбора)

Все файлы, имя которых **начинается с `Car`** (регистр не важен):

```
assets/models/
  Car_yellow.glb
  Car_red.glb
  Car_blue.glb
  ...
```

На старте игры показываются превью — выбор машины.

Масштаб **1:1** как в Blender — игра не уменьшает и не перекрашивает модели; текстуры берутся из GLB.

## Трамплин

```
assets/models/
  Tramp.glb
```

Без `Tramp.glb` используется фиолетовая заглушка.

## Текстуры мира

```
assets/textures/
  road.png      ← дорога
  ground.png    ← земля
```

См. `assets/textures/README.md`.

## Сборка манифеста

```bat
cd D:\Bootstrap\izzz108.one
.\build-github.bat silent
```
