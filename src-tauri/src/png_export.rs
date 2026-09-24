use crate::files::Result;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
};

// One row is bounded independently of the image's total pixel count.
pub const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;
pub struct PngExport {
    pub id: String,
    file: File,
    writer: png::StreamWriter<'static, File>,
    remaining: u64,
}
impl PngExport {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        if width == 0
            || height == 0
            || width as u64 * 4 > MAX_BUFFER_BYTES as u64
            || height > 0x7fff_ffff
        {
            return Err("PNG exceeds the streaming encoder dimension limit".into());
        }
        // Unnamed temporary files are reclaimed even if the process crashes.
        let file = tempfile::tempfile().map_err(|e| e.to_string())?;
        let mut encoder =
            png::Encoder::new(file.try_clone().map_err(|e| e.to_string())?, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let writer = encoder
            .write_header()
            .map_err(|e| e.to_string())?
            .into_stream_writer()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            id: uuid::Uuid::new_v4().to_string(),
            file,
            writer,
            remaining: width as u64 * height as u64 * 4,
        })
    }
    pub fn write(&mut self, bytes: &[u8]) -> Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_BUFFER_BYTES || bytes.len() as u64 > self.remaining
        {
            return Err("Invalid PNG pixel chunk".into());
        }
        self.writer.write_all(bytes).map_err(|e| e.to_string())?;
        self.remaining -= bytes.len() as u64;
        Ok(())
    }
    pub fn finish(mut self) -> Result<Vec<u8>> {
        if self.remaining != 0 {
            return Err("Incomplete PNG pixels".into());
        }
        self.writer.finish().map_err(|e| e.to_string())?;
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        self.file
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streams_wider_than_canvas_and_preserves_pixels_across_chunks() {
        let width = 33001;
        let mut export = PngExport::new(width, 3).unwrap();
        let pixels: Vec<u8> = (0..width as usize * 3 * 4)
            .map(|i| (i % 251) as u8)
            .collect();
        for chunk in pixels.chunks(997) {
            export.write(chunk).unwrap();
        }
        let bytes = export.finish().unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut actual = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut actual).unwrap();
        assert_eq!((info.width, info.height), (width, 3));
        assert_eq!(actual, pixels);
    }
    #[test]
    fn rejects_invalid_dimensions_and_truncated_or_excess_pixels() {
        assert!(PngExport::new(0, 1).is_err());
        assert!(PngExport::new(MAX_BUFFER_BYTES as u32 / 4 + 1, 1).is_err());
        assert!(PngExport::new(1, u32::MAX).is_err());
        let mut export = PngExport::new(1, 1).unwrap();
        assert!(export.write(&[]).is_err());
        assert!(export.write(&[0; 5]).is_err());
        assert!(export.finish().is_err());
    }
}
