import React, { useState, useCallback, useEffect } from 'react'

import '../../../styles/Agent.css';
import { EmojiPickerProps } from './types'

// Emoji category data
const EMOJI_CATEGORIES: Record<string, string[]> = {
  "Costumed Faces": ["🤡","👻","👽","🤖","🎃","😈","👹","💩"],
  "Cat Faces": ["😺","😸","😹","😻","😼","😽","🙀","😿","😾"],
  "Monkey Faces": ["🐵","🐒","🙈","🙉","🙊"],
  "Hearts": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝"],
  "Smileys & Emotions": [
    "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇",
    "🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
    "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎",
    "🥳","😏","😒","😞","😔","😟","😕","🙁","☹️",
    "😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡"
  ],
  "Professions & Roles": [
    "👮","👷","💂","🕵️","👩‍⚕️","👨‍⚕️","👩‍🌾","👨‍🌾",
    "👩‍🍳","👨‍🍳","👩‍🎓","👨‍🎓","👩‍🏫","👨‍🏫",
    "👩‍⚖️","👨‍⚖️","👩‍💻","👨‍💻","👩‍🎤","👨‍🎤",
    "👩‍🚀","👨‍🚀","👩‍🚒","👨‍🚒"
  ],
  "Fantasy Characters": [
    "👼","🤶","🎅","🧙","🧝","🧛","🧟","🧞","🧜","🧚"
  ],
  "Animals & Nature": [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
    "🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤",
    "🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄",
    "🐝","🦋","🐌","🐞","🐜","🦟","🌸","🌼","🌻","🌲","🌳"
  ],
  "Food & Drink": [
    "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒",
    "🥝","🍅","🥑","🍆","🥔","🥕","🌽","🌶️","🥒",
    "🍞","🥐","🥖","🧀","🥚","🍳","🥞","🥓",
    "🍔","🍟","🍕","🌭","🥪","🌮","🌯",
    "🍣","🍱","🍛","🍜","🍝","🍰","🧁","🍩","🍪","☕","🍵"
  ],
  "Travel & Places": [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒",
    "🚲","🛴","🛵","✈️","🛫","🛬","🚀","🚁",
    "🚢","⛴️","🗽","🗼","🏰","🏯","🏟️","🏖️","⛰️","🌋","🏕️"
  ],
  "Activities": [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🎱",
    "🏓","🏸","🥅","🏒","🏑","🥍","🏏",
    "🎿","⛷️","🏂","🏋️","🤼","🤸","⛹️","🤺","🤾","🏊","🚴","🏇"
  ],
  "Objects": [
    "⌚","📱","💻","🖥️","🖨️","⌨️","🖱️","🖲️",
    "📷","📸","🎥","📺","📻","🎙️","🎚️","🎛️",
    "💡","🔦","🕯️","🪔","🔌","🔋",
    "📕","📗","📘","📙","📚","📓","📒","📔",
    "✏️","🖊️","🖋️","✂️","📎","🗂️","📦","🔒","🔑"
  ]
}

const CATEGORY_NAMES = Object.keys(EMOJI_CATEGORIES)

// Find the category an emoji belongs to
const findEmojiCategory = (emoji: string): string => {
  for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
    if (emojis.includes(emoji)) {
      return category
    }
  }
  return CATEGORY_NAMES[0] // Default to the first category
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({
  isOpen,
  onClose,
  onEmojiSelect,
  currentEmoji
}) => {
  const [selectedEmoji, setSelectedEmoji] = useState(currentEmoji || '🤖')
  const [activeCategory, setActiveCategory] = useState(CATEGORY_NAMES[0])

  // When currentEmoji prop changes, sync update selectedEmoji and activeCategory state
  useEffect(() => {
    const emoji = currentEmoji || '🤖'
    setSelectedEmoji(emoji)
    setActiveCategory(findEmojiCategory(emoji))
  }, [currentEmoji])

  const handleEmojiClick = useCallback((emoji: string) => {
    setSelectedEmoji(emoji)
  }, [])

  const handleConfirm = useCallback(() => {
    onEmojiSelect(selectedEmoji)
    onClose()
  }, [selectedEmoji, onEmojiSelect, onClose])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  if (!isOpen) return null

  return (
    <div className="emoji-picker-overlay" onClick={handleOverlayClick}>
      <div className="emoji-picker-modal">
        {/* Header */}
        <div className="picker-header">
          <h3>Choose Agent Avatar</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {/* Selected Display */}
        <div className="selected-display">
          <div className="selected-emoji">{selectedEmoji}</div>
          <span className="selected-label">Selected</span>
        </div>

        {/* Category Tabs */}
        <div className="emoji-category-tabs">
          {CATEGORY_NAMES.map((category) => (
            <button
              key={category}
              className={`category-tab ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Emoji Grid */}
        <div className="emoji-grid">
          {(EMOJI_CATEGORIES[activeCategory] || []).map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              className={`emoji-item ${selectedEmoji === emoji ? 'selected' : ''}`}
              onClick={() => handleEmojiClick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="picker-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default EmojiPicker