import React from 'react';

interface HooksIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

const HooksIcon: React.FC<HooksIconProps> = ({ size = 24, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <circle cx="12" cy="4" r="1.75" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M12 5.75V14.5C12 18.09 9.09 21 5.5 21C3.57 21 2 19.43 2 17.5C2 15.57 3.57 14 5.5 14C7.16 14 8.5 15.34 8.5 17"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.5 17L6.2 15.75"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default HooksIcon;
