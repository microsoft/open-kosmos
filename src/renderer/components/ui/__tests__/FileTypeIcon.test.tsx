// @vitest-environment happy-dom
/**
 * Tests for FileTypeIcon component and getFileCategory utility
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileTypeIcon, { getFileCategory } from '../FileTypeIcon';

describe('getFileCategory', () => {
  it('returns pdf for .pdf files', () => {
    expect(getFileCategory('document.pdf')).toBe('pdf');
  });

  it('returns word for .doc/.docx/.odt/.rtf', () => {
    expect(getFileCategory('doc.doc')).toBe('word');
    expect(getFileCategory('doc.docx')).toBe('word');
    expect(getFileCategory('doc.odt')).toBe('word');
    expect(getFileCategory('doc.rtf')).toBe('word');
  });

  it('returns excel for spreadsheet extensions', () => {
    expect(getFileCategory('data.xls')).toBe('excel');
    expect(getFileCategory('data.xlsx')).toBe('excel');
    expect(getFileCategory('data.csv')).toBe('excel');
    expect(getFileCategory('data.ods')).toBe('excel');
  });

  it('returns ppt for presentation extensions', () => {
    expect(getFileCategory('slides.ppt')).toBe('ppt');
    expect(getFileCategory('slides.pptx')).toBe('ppt');
    expect(getFileCategory('slides.odp')).toBe('ppt');
  });

  it('returns archive for compression formats', () => {
    expect(getFileCategory('archive.zip')).toBe('archive');
    expect(getFileCategory('archive.rar')).toBe('archive');
    expect(getFileCategory('archive.7z')).toBe('archive');
    expect(getFileCategory('archive.tar')).toBe('archive');
    expect(getFileCategory('archive.gz')).toBe('archive');
    expect(getFileCategory('archive.dmg')).toBe('archive');
  });

  it('returns executable for binary/script formats', () => {
    expect(getFileCategory('program.exe')).toBe('executable');
    expect(getFileCategory('script.bat')).toBe('executable');
    expect(getFileCategory('script.sh')).toBe('executable');
    expect(getFileCategory('library.dll')).toBe('executable');
    expect(getFileCategory('app.apk')).toBe('executable');
  });

  it('returns image for image extensions', () => {
    expect(getFileCategory('photo.png')).toBe('image');
    expect(getFileCategory('photo.jpg')).toBe('image');
    expect(getFileCategory('photo.jpeg')).toBe('image');
    expect(getFileCategory('photo.gif')).toBe('image');
    expect(getFileCategory('icon.svg')).toBe('image');
    expect(getFileCategory('photo.webp')).toBe('image');
    expect(getFileCategory('photo.avif')).toBe('image');
  });

  it('returns video for video extensions', () => {
    expect(getFileCategory('video.mp4')).toBe('video');
    expect(getFileCategory('video.avi')).toBe('video');
    expect(getFileCategory('video.mkv')).toBe('video');
    expect(getFileCategory('video.mov')).toBe('video');
  });

  it('returns audio for audio extensions', () => {
    expect(getFileCategory('music.mp3')).toBe('audio');
    expect(getFileCategory('music.wav')).toBe('audio');
    expect(getFileCategory('music.flac')).toBe('audio');
    expect(getFileCategory('music.ogg')).toBe('audio');
  });

  it('returns code for source code extensions', () => {
    expect(getFileCategory('app.js')).toBe('code');
    expect(getFileCategory('app.ts')).toBe('code');
    expect(getFileCategory('app.tsx')).toBe('code');
    expect(getFileCategory('app.py')).toBe('code');
    expect(getFileCategory('app.java')).toBe('code');
    expect(getFileCategory('app.rs')).toBe('code');
    expect(getFileCategory('styles.css')).toBe('code');
    expect(getFileCategory('page.html')).toBe('code');
    expect(getFileCategory('page.vue')).toBe('code');
  });

  it('returns data for config/data extensions', () => {
    expect(getFileCategory('config.json')).toBe('data');
    expect(getFileCategory('config.yaml')).toBe('data');
    expect(getFileCategory('config.yml')).toBe('data');
    expect(getFileCategory('config.toml')).toBe('data');
    expect(getFileCategory('config.xml')).toBe('data');
    expect(getFileCategory('query.sql')).toBe('data');
  });

  it('returns text for text file extensions', () => {
    expect(getFileCategory('notes.txt')).toBe('text');
    expect(getFileCategory('README.md')).toBe('text');
    expect(getFileCategory('app.log')).toBe('text');
  });

  it('returns other for unknown extensions', () => {
    expect(getFileCategory('file.xyz')).toBe('other');
    expect(getFileCategory('noextension')).toBe('other');
  });

  it('handles uppercase extensions case-insensitively', () => {
    expect(getFileCategory('doc.PDF')).toBe('pdf');
    expect(getFileCategory('img.PNG')).toBe('image');
  });
});

describe('FileTypeIcon', () => {
  it('renders an svg', () => {
    render(<FileTypeIcon fileName="document.pdf" />);
    const svg = document.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('uses provided size', () => {
    render(<FileTypeIcon fileName="file.txt" size={32} />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('defaults to size 20', () => {
    render(<FileTypeIcon fileName="file.txt" />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('applies category class to svg', () => {
    render(<FileTypeIcon fileName="file.pdf" />);
    const svg = document.querySelector('svg');
    expect(svg?.className).toContain('file-type-icon--pdf');
  });

  it('applies custom className', () => {
    render(<FileTypeIcon fileName="file.pdf" className="icon-custom" />);
    const svg = document.querySelector('svg');
    expect(svg?.className).toContain('icon-custom');
  });

  it('has aria-label with category', () => {
    render(<FileTypeIcon fileName="file.pdf" />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'pdf file icon');
  });

  it('renders icons for all categories without crashing', () => {
    const files = [
      'text.txt', 'doc.pdf', 'doc.docx', 'sheet.xlsx', 'slide.pptx',
      'archive.zip', 'program.exe', 'photo.png', 'clip.mp4', 'track.mp3',
      'app.ts', 'config.json', 'unknown.xyz',
    ];

    for (const fileName of files) {
      const { unmount } = render(<FileTypeIcon fileName={fileName} />);
      expect(document.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });
});
