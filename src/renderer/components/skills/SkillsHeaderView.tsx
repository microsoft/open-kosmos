'use client'

import React from 'react'
import { Badge } from '../ui/badge'
import '../../styles/Header.css'

interface SkillsHeaderViewProps {
  totalSkills: number
  onAddClick: (buttonElement: HTMLElement) => void
}

// Skills icon component
const SkillsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <mask id="mask0_482_1426" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <path d="M10.5416 8.60759L11.642 6.37799C11.8907 5.874 12.6094 5.874 12.8581 6.37799L13.9585 8.60759L16.419 8.96512C16.9752 9.04594 17.1972 9.72944 16.7948 10.1217L15.0143 11.8572L15.4347 14.3078C15.5297 14.8617 14.9482 15.2842 14.4508 15.0226L12.25 13.8656L10.0493 15.0226C9.55182 15.2842 8.9704 14.8617 9.06541 14.3078L9.48571 11.8572L7.70527 10.1217C7.30281 9.72944 7.5249 9.04594 8.08108 8.96512L10.5416 8.60759ZM11.6 9.52747C11.5012 9.72761 11.3103 9.86633 11.0894 9.89842L9.6358 10.1096L10.6876 11.1349C10.8474 11.2907 10.9204 11.5152 10.8826 11.7351L10.6343 13.1829L11.9345 12.4993C12.132 12.3955 12.368 12.3955 12.5656 12.4993L13.8657 13.1829L13.6174 11.7351C13.5797 11.5152 13.6526 11.2907 13.8124 11.1349L14.8643 10.1096L13.4107 9.89842C13.1898 9.86633 12.9989 9.72761 12.9001 9.52747L12.25 8.21029L11.6 9.52747ZM6.5 2C5.11929 2 4 3.11929 4 4.5V19.5C4 20.8807 5.11929 22 6.5 22H19.75C20.1642 22 20.5 21.6642 20.5 21.25C20.5 20.8358 20.1642 20.5 19.75 20.5H6.5C5.94772 20.5 5.5 20.0523 5.5 19.5H19.75C20.1642 19.5 20.5 19.1642 20.5 18.75V4.5C20.5 3.11929 19.3807 2 18 2H6.5ZM19 18H5.5V4.5C5.5 3.94772 5.94772 3.5 6.5 3.5H18C18.5523 3.5 19 3.94772 19 4.5V18Z" fill="#242424"/>
    </mask>
    <g mask="url(#mask0_482_1426)">
      <rect width="24" height="24" fill="#272320"/>
    </g>
  </svg>
)

const SkillsHeaderView: React.FC<SkillsHeaderViewProps> = ({
  totalSkills,
  onAddClick
}) => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <SkillsIcon />
        <span className="header-name">Skills</span>
        <div className="mcp-status-badges">
          <Badge
            variant="normal"
            className="text-xs"
          >
            available skills: {totalSkills}
          </Badge>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="btn-action"
          onClick={(e) => onAddClick(e.currentTarget)}
          title="Add Skill"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="#272320"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default SkillsHeaderView