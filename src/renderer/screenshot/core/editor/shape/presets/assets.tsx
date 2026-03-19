import React from 'react';

export interface Coord {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface CommonProps {
  coord: Coord;
  onPointerDown?: (e: React.PointerEvent) => void;
}

export interface NumberProps extends CommonProps {
  fill: string;
  index?: number;
}

export function Number(props: NumberProps) {
  const { coord, fill, index = 1, onPointerDown } = props;
  return (
    <svg {...coord} onPointerDown={onPointerDown} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#clip0_3689_2307)">
          <path d="M1.25 3.75C1.25 2.36929 2.36929 1.25 3.75 1.25H16.25C17.6307 1.25 18.75 2.36929 18.75 3.75V16.25C18.75 17.6307 17.6307 18.75 16.25 18.75H3.75C2.36929 18.75 1.25 17.6307 1.25 16.25V3.75Z" fill={fill}/>
          <text x="50%" y="50%" fontSize={index && index.toString().length >= 3 ? "8px" : "12px"} fontWeight="500" fill="white" textAnchor="middle" dominantBaseline="central">
            {index}
          </text>
        </g>
      <defs>
        <clipPath id="clip0_3689_2307">
          <rect width="20" height="20" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  );
}

export function Flag(props: CommonProps) {
  const { coord, onPointerDown } = props;
  return (
    <svg {...coord} onPointerDown={onPointerDown} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.2662 7.46489L5 2.5H4.375V13.125H5L17.2662 8.16011C17.5786 8.03366 17.5786 7.59134 17.2662 7.46489Z" fill="#F8312F"/>
      <path d="M2.5 2.5C2.5 1.80964 3.05964 1.25 3.75 1.25C4.44036 1.25 5 1.80964 5 2.5V18.75H2.5V2.5Z" fill="#E39D89"/>
    </svg>
  );
}

export function Heart(props: CommonProps) {
  const { coord, onPointerDown } = props;
  return (
    <svg {...coord} onPointerDown={onPointerDown} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.74974 4.13475C6.66522 2.67702 9.06224 4.44725 9.99974 5.69725C10.9372 4.44725 13.3343 2.67702 16.2497 4.13475C19.9997 6.00975 19.0622 10.6973 16.2497 13.5098C14.8774 14.8821 12.4605 17.299 10.6927 18.6433C10.2843 18.9539 9.7257 18.94 9.32645 18.6177C7.706 17.3098 5.10289 14.8629 3.74974 13.5098C0.937231 10.6973 -0.00026238 6.00975 3.74974 4.13475Z" fill="#F8312F"/>
      <path d="M9.99972 5.69724V7.60297C10.7933 5.92538 12.7655 3.68507 16.0359 4.03316C13.2174 2.76364 10.9142 4.47793 9.99972 5.69724Z" fill="#CA0B4A"/>
      <path d="M7.4658 3.84532C6.41317 3.47853 5.14044 3.43941 3.74974 4.13475C-0.00026238 6.00975 0.937231 10.6972 3.74974 13.5098C5.10289 14.8629 7.706 17.3098 9.32645 18.6177C9.7257 18.94 10.2843 18.9539 10.6927 18.6433C10.8516 18.5225 11.0157 18.393 11.1839 18.2564C9.39969 16.9175 6.89579 14.8073 5.53668 13.5925C2.43868 10.8235 1.40602 6.20843 5.53668 4.36241C6.20781 4.06247 6.85401 3.90134 7.4658 3.84532Z" fill="#CA0B4A"/>
      <ellipse cx="14.6735" cy="7.87107" rx="1.77221" ry="2.98828" transform="rotate(30 14.6735 7.87107)" fill="#F37366"/>
    </svg>
  );
}

export function Pushpin(props: CommonProps) {
  const { coord, onPointerDown } = props;
  return (
    <svg {...coord} onPointerDown={onPointerDown} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.48906 18.4344C1.17031 18.1156 1.17031 17.6031 1.48906 17.2844L7.08906 11.6844L8.23906 12.8344L2.63906 18.4344C2.32031 18.7531 1.80781 18.7531 1.48906 18.4344Z" fill="#D3D3D3"/>
      <path d="M12.5207 11.9838L15.3978 9.10674L14.3752 5.3125L10.753 4.46198L7.87598 7.33899L8.7502 10.9375L12.5207 11.9838Z" fill="#CA0B4A"/>
      <path d="M10.7389 4.45312L15.4076 9.11562C16.0451 9.75312 17.0764 9.75312 17.7139 9.11562L18.4076 8.42188C18.6701 8.15938 18.6701 7.73438 18.4076 7.47188L12.3826 1.44688C12.1201 1.18438 11.6951 1.18438 11.4326 1.44688L10.7389 2.14063C10.1014 2.77813 10.1014 3.81562 10.7389 4.45312Z" fill="#F8312F"/>
      <path d="M3.80137 9.10311L10.7514 16.0531C11.0764 16.3781 11.6076 16.3781 11.9326 16.0531L12.5014 15.4844C13.4764 14.5094 13.4764 12.9344 12.5014 11.9594L7.89512 7.35311C6.92012 6.37811 5.34512 6.37811 4.37012 7.35311L3.80137 7.92186C3.47637 8.24686 3.47637 8.77811 3.80137 9.10311Z" fill="#F8312F"/>
    </svg>
  );
}

export function RoundPushpin(props: CommonProps) {
  const { coord, onPointerDown } = props;
  return (
    <svg {...coord} onPointerDown={onPointerDown} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.95645 18.7C9.60645 18.7 9.3252 18.4188 9.3252 18.0688V9.96252H10.5939V18.0625C10.5877 18.4188 10.3064 18.7 9.95645 18.7Z" fill="#D3D3D3"/>
      <path d="M9.95625 11.1625C12.6935 11.1625 14.9125 8.94351 14.9125 6.20625C14.9125 3.46899 12.6935 1.25 9.95625 1.25C7.21899 1.25 5 3.46899 5 6.20625C5 8.94351 7.21899 11.1625 9.95625 11.1625Z" fill="#F70A8D"/>
      <path d="M10.3122 3.38126C9.66217 4.03126 9.63092 5.04376 10.2372 5.65001C10.8434 6.25626 11.8622 6.22501 12.5059 5.57501C13.1559 4.92501 13.1872 3.91251 12.5809 3.30626C11.9747 2.70001 10.9559 2.73126 10.3122 3.38126Z" fill="white"/>
    </svg>
  );
}
