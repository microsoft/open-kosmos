'use client'

import React from 'react'
import { useParams } from 'react-router-dom'
import AddNewMcpServerViewHeader from './AddNewMcpServerViewHeader'
import AddNewMcpServerViewContent from './AddNewMcpServerViewContent'
import '../../styles/AddNewMcpServerView.css'

const AddNewMcpServerView: React.FC = () => {
  const { editServerName } = useParams<{ editServerName?: string }>()

  return (
    <div className="add-new-mcp-server-view">
      <AddNewMcpServerViewHeader editServerName={editServerName} />
      <AddNewMcpServerViewContent editServerName={editServerName} />
    </div>
  )
}

export default AddNewMcpServerView