using UnityEngine;
using UnityEngine.InputSystem;

namespace FirstRoom
{
    /// <summary>读取键盘，在物理帧中移动角色。数值可在 Inspector 中修改。</summary>
    [RequireComponent(typeof(Rigidbody2D), typeof(CapsuleCollider2D))]
    public class RoomPlayerController : MonoBehaviour
    {
        [Header("Movement / 移动")]
        [SerializeField, Tooltip("左右移动速度，单位：米/秒")] private float moveSpeed = 6f;
        [SerializeField, Tooltip("起跳时的向上速度")] private float jumpSpeed = 10.5f;
        [SerializeField, Tooltip("哪些图层可以当作地面")] private LayerMask groundLayers;
        [SerializeField] private Transform visual;

        private Rigidbody2D body;
        private CapsuleCollider2D capsule;
        private readonly RaycastHit2D[] groundHits = new RaycastHit2D[8];
        private Vector2 spawnPosition;
        private float horizontalInput;
        private float jumpBuffer;
        private float coyoteTime;
        private bool controlsLocked;

        public bool IsGrounded { get; private set; }
        public Vector2 SpawnPosition => spawnPosition;

        private void Awake()
        {
            body = GetComponent<Rigidbody2D>();
            capsule = GetComponent<CapsuleCollider2D>();
            spawnPosition = body.position;
        }

        private void Update()
        {
            var keyboard = Keyboard.current;
            horizontalInput = 0f;
            if (keyboard == null || controlsLocked) return;

            if (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed) horizontalInput -= 1f;
            if (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed) horizontalInput += 1f;
            if (keyboard.spaceKey.wasPressedThisFrame) jumpBuffer = 0.12f;

            if (visual != null && horizontalInput != 0f)
                visual.localScale = new Vector3(Mathf.Sign(horizontalInput), 1f, 1f);

            // 掉出房间时回到出生点，方便以后编辑平台时试错。
            if (body.position.y < -8f) Respawn();
        }

        private void FixedUpdate()
        {
            var filter = new ContactFilter2D();
            filter.SetLayerMask(groundLayers);
            filter.useTriggers = false;
            int count = capsule.Cast(Vector2.down, filter, groundHits, 0.08f);
            IsGrounded = false;
            for (int i = 0; i < count; i++)
                if (groundHits[i].normal.y > 0.5f) IsGrounded = true;

            coyoteTime = IsGrounded ? 0.12f : coyoteTime - Time.fixedDeltaTime;
            jumpBuffer -= Time.fixedDeltaTime;
            Vector2 velocity = body.linearVelocity;
            velocity.x = controlsLocked ? 0f : horizontalInput * moveSpeed;
            if (!controlsLocked && jumpBuffer > 0f && coyoteTime > 0f && velocity.y <= 0.1f)
            {
                velocity.y = jumpSpeed;
                jumpBuffer = 0f;
                coyoteTime = 0f;
            }
            body.linearVelocity = velocity;
        }

        public void SetControlsLocked(bool locked)
        {
            controlsLocked = locked;
            horizontalInput = 0f;
            jumpBuffer = 0f;
        }

        public void Respawn()
        {
            body.position = spawnPosition;
            body.linearVelocity = Vector2.zero;
            horizontalInput = jumpBuffer = coyoteTime = 0f;
            IsGrounded = false;
            if (visual != null) visual.localScale = Vector3.one;
        }

        // 仅由场景创建工具设置初始引用；日常调参直接使用 Inspector。
        public void Configure(LayerMask layers, Transform characterVisual)
        {
            groundLayers = layers;
            visual = characterVisual;
        }
    }
}
