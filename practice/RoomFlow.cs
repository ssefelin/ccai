using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace FirstRoom
{
    /// <summary>房间的简单规则：点灯 → 开门 → 完成。管理提示和重新开始。</summary>
    public class RoomFlow : MonoBehaviour
    {
        [SerializeField] private RoomPlayerController player;
        [SerializeField] private RoomInteractable lantern;
        [SerializeField] private RoomInteractable exit;
        [SerializeField] private Text objectiveText;
        [SerializeField] private Text stateText;
        [SerializeField] private Text promptText;
        [SerializeField] private Text messageText;
        [SerializeField] private GameObject completionPanel;

        private RoomInteractable nearby;
        private float messageTimer;

        public bool LanternLit { get; private set; }
        public bool Completed { get; private set; }
        public RoomInteractable Nearby => nearby;

        private void Start()
        {
            RefreshUI();
            ShowMessage("Climb the two platforms to reach the lantern.");
        }

        private void Update()
        {
            var keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.rKey.wasPressedThisFrame) RestartRoom();
                else if (!Completed && keyboard.eKey.wasPressedThisFrame && nearby != null) nearby.Interact();
            }

            if (messageTimer > 0f)
            {
                messageTimer -= Time.deltaTime;
                if (messageTimer <= 0f) messageText.text = "";
            }
            promptText.text = !Completed && nearby != null ? nearby.Prompt : "";
        }

        public void SetNearby(RoomInteractable interactable) => nearby = interactable;
        public void ClearNearby(RoomInteractable interactable)
        {
            if (nearby == interactable) nearby = null;
        }

        public void LightLantern()
        {
            if (LanternLit || Completed) return;
            LanternLit = true;
            lantern.SetLit(true);
            exit.SetLit(true);
            ShowMessage("The lantern is lit. The exit on the right is ready.");
            RefreshUI();
        }

        public void TryExit()
        {
            if (Completed) return;
            if (!LanternLit)
            {
                ShowMessage("The exit is sealed. Light the lantern on the upper platform first.");
                return;
            }
            Completed = true;
            player.SetControlsLocked(true);
            RefreshUI();
        }

        public void RestartRoom()
        {
            LanternLit = Completed = false;
            nearby = null;
            lantern.SetLit(false);
            exit.SetLit(false);
            player.SetControlsLocked(false);
            player.Respawn();
            ShowMessage("A fresh start. Climb up and light the lantern.");
            RefreshUI();
        }

        private void ShowMessage(string message)
        {
            messageText.text = message;
            messageTimer = 5f;
        }

        private void RefreshUI()
        {
            objectiveText.text = Completed ? "Room complete. Try changing something in the Editor!"
                : LanternLit ? "02 / Reach the exit on the right. Press E to enter."
                : "01 / Reach the upper platform. Press E to light the lantern.";
            stateText.text = LanternLit ? "LANTERN  /  ON" : "LANTERN  /  OFF";
            stateText.color = LanternLit ? new Color(0.61f, 0.9f, 0.75f) : new Color(0.73f, 0.79f, 0.84f);
            completionPanel.SetActive(Completed);
        }

        public void Configure(RoomPlayerController roomPlayer, RoomInteractable roomLantern,
            RoomInteractable roomExit, Text objective, Text state, Text prompt, Text message, GameObject panel)
        {
            player = roomPlayer;
            lantern = roomLantern;
            exit = roomExit;
            objectiveText = objective;
            stateText = state;
            promptText = prompt;
            messageText = message;
            completionPanel = panel;
        }
    }
}
