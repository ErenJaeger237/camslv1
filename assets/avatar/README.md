# Avatar Model

Place your character GLB file here as `model.glb`.

## How to get a free Mixamo character (recommended)

Mixamo characters use a consistent bone naming convention that the app expects.

1. Go to https://www.mixamo.com (free — needs an Adobe account)
2. Click "Characters" and choose any character you like.
   Good choices: Michelle, Y Bot, Mousey, Kaya, Remy
3. Click **DOWNLOAD**
   - Format: **FBX**
   - Skin: **With Skin**
   - Pose: **T-pose**
4. Convert the downloaded `.fbx` to `.glb`:
   - **Option A (Blender — recommended):**
     1. Open Blender → File → Import → FBX → select your file
     2. File → Export → glTF 2.0 (.glb/.gltf)
     3. In the export dialog: Format = glTF Binary (.glb), include Armature
   - **Option B (Online converter):**
     Upload the FBX to https://products.aspose.com/3d/conversion/fbx-to-gltf/
     or any FBX→GLB converter and download the result.
5. Rename the output file to `model.glb` and place it in this folder.

## Bone naming

The app uses Mixamo's standard bone names for finger animation:
- `mixamorigRightHandThumb1/2/3`
- `mixamorigRightHandIndex1/2/3`
- `mixamorigRightHandMiddle1/2/3`
- `mixamorigRightHandRing1/2/3`
- `mixamorigRightHandPinky1/2/3`

If your model uses different bone names (e.g. Quaternius-style `UpperArm_R`),
update the `HAND_BONE_MAP` constant near the top of `ui/index.html`.

## Fallback

If `model.glb` is not found, the app automatically falls back to the
cartoon primitive avatar. Nothing breaks — you just won't get the GLB quality.
