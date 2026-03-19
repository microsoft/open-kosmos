import { getString } from '../../../common/localString';
import { SizeRangeConfig } from '../common';
import SliderThumb from './slider';

function SizePicker(props: {
  size: number;
  type: 'arrow' | 'ellipse' | 'pencil' | 'square' | 'mosaic';
  onChange: (size: number) => void;
}) {
  const { size, type, onChange } = props;
  const range = SizeRangeConfig[type];
  return (
    <div className='sizeSliderPicker'>
      <h4 className="tool-config-title">{getString('size')}</h4>
      <SliderThumb value={size} {...range} onChange={onChange}></SliderThumb>
    </div>
  );
}

export default SizePicker;
