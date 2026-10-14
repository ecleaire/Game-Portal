extends Node3D

var cube: MeshInstance3D

func _ready() -> void:
    cube = MeshInstance3D.new()
    cube.mesh = BoxMesh.new()
    var material := StandardMaterial3D.new()
    material.albedo_color = Color(0.12, 0.9, 0.72)
    cube.material_override = material
    add_child(cube)
    var camera := Camera3D.new()
    camera.position = Vector3(2.8, 2.0, 3.6)
    add_child(camera)
    camera.look_at(Vector3.ZERO)
    camera.current = true
    var light := DirectionalLight3D.new()
    light.rotation_degrees = Vector3(-45, -35, 0)
    add_child(light)
    if OS.has_feature("web"):
        var doc = JavaScriptBridge.get_interface("document")
        doc.body.setAttribute("data-portal-3d", "ready")

func _process(delta: float) -> void:
    cube.rotate_y(delta * 0.65)

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
    if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
        Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
